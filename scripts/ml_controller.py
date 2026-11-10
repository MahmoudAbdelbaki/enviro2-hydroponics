#!/usr/bin/env python3
"""
ml_controller.py — Reference closed-loop ML controller & anomaly detector for testing.
Polls ONLY noisy bulk sensor readings (/readings), detects implied pump/leak faults,
raises alerts (/alerts), and sends PLC-guarded dosing commands (/commands).
"""

import argparse
import json
import math
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent


def http_json(method: str, url: str, payload=None, token: str = None):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def do_sat_approx(t_c: float) -> float:
    return 14.62 - 0.3898 * t_c + 0.006969 * (t_c ** 2) - 5.897e-5 * (t_c ** 3)


def main():
    parser = argparse.ArgumentParser(description="Run closed-loop ML anomaly & dosing test.")
    parser.add_argument("--url", default="http://localhost:8080")
    parser.add_argument("--api-key", default="dev-ml-secret-key")
    args = parser.parse_args()

    # Ensure server is running
    proc = None
    try:
        http_json("GET", f"{args.url}/healthz")
    except Exception:
        bin_path = ROOT_DIR / "bin" / "hydro"
        proc = subprocess.Popen([str(bin_path)], cwd=str(ROOT_DIR), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.4)

    try:
        with open(ROOT_DIR / "testdata" / "valid_farm.json", "r", encoding="utf-8") as f:
            farm_spec = json.load(f)
        _, farm = http_json("POST", f"{args.url}/api/v1/farms", farm_spec)
        _, sim = http_json("POST", f"{args.url}/api/v1/simulations", {
            "farm_id": farm["id"],
            "seed": 42,
            "step_seconds": 300,
            "mode": "paused",
        })
        sim_id = sim["id"]
        print(f"[ML Test] Started Simulation {sim_id}")

        # 1. Fast-forward to mid-vegetative growth (Day 10 = 2880 ticks) so roots have realistic O2 demand
        http_json("POST", f"{args.url}/api/v1/simulations/{sim_id}/advance", {"steps": 2880})

        # 2. Operator injects pump_degradation (95% flow loss) + aeration_loss (100%)
        print("[Operator] Injecting hidden pump_degradation (0.95) + aeration_loss (1.0)...")
        http_json("POST", f"{args.url}/api/v1/simulations/{sim_id}/faults", {
            "kind": "pump_degradation",
            "target_component_id": "pump-1",
            "intensity": 0.95,
            "trigger_at_sim_sec": 0,
        })
        http_json("POST", f"{args.url}/api/v1/simulations/{sim_id}/faults", {
            "kind": "aeration_loss",
            "target_component_id": "aerator-1",
            "intensity": 1.0,
            "trigger_at_sim_sec": 0,
        })
        http_json("POST", f"{args.url}/api/v1/simulations/{sim_id}/advance", {"steps": 48})

        # 3. ML Controller polls ONLY noisy /readings
        _, readings = http_json("GET", f"{args.url}/api/v1/simulations/{sim_id}/readings?limit=16")
        latest = {}
        for r in readings:
            if r["kind"] not in latest and r["value"] is not None:
                latest[r["kind"]] = r["value"]

        tw = latest.get("T_w", 20.0)
        do_val = latest.get("DO", 8.0)
        ec_val = latest.get("EC", 1.48)
        ph_val = latest.get("pH", 5.80)
        vres_val = latest.get("V_res", 250.0)
        expected_do = do_sat_approx(tw) * 0.92

        print(f"[ML Sensor Poll] EC={ec_val:.2f} dS/m | pH={ph_val:.2f} | T_w={tw:.2f}C | DO={do_val:.2f} mg/L (Expected >= {expected_do:.2f} mg/L) | V_res={vres_val:.1f} L")

        if do_val < expected_do - 0.35:
            print("[ML Anomaly Detector] Detected depleted channel DO relative to water temperature -> Raising IMPLIED_PUMP_OR_AERATION_FAULT alert!")
            code, alert = http_json("POST", f"{args.url}/api/v1/simulations/{sim_id}/alerts", {
                "component_id": "pump-1",
                "severity": "critical",
                "code": "IMPLIED_PUMP_OR_AERATION_FAULT",
                "message": f"Channel ch-1 DO ({do_val:.2f} mg/L) is significantly below saturation for T_w={tw:.1f}C; suspect reduced flow from pump-1.",
            }, token=args.api_key)
            print(f"  -> Alert HTTP {code}: id={alert.get('id')} component_id={alert.get('component_id')}")

        # 4. ML Controller sends a safe top-up/nutrient dose
        code, cmd = http_json("POST", f"{args.url}/api/v1/simulations/{sim_id}/commands", {
            "target_component_id": "reservoir-1",
            "action": "dose",
            "dose_stock_a_ml": 10.0,
            "dose_stock_b_ml": 10.0,
            "reason": "Closed-loop ML maintenance dose",
        }, token=args.api_key)
        print(f"[ML Actuation] Safe dose HTTP {code}: status={cmd.get('status')}")
    finally:
        if proc is not None:
            proc.terminate()
            proc.wait(timeout=5)


if __name__ == "__main__":
    main()
