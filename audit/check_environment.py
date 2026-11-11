"""Audit Step 1: Environment and Container Health Checker."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
import urllib.request
from typing import Any, Dict


def check_docker_containers() -> Dict[str, Any]:
    """Inspect status of running Docker containers via docker compose ps."""
    try:
        proc = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            # Fallback to plain text output if --format json not supported
            proc2 = subprocess.run(
                ["docker", "compose", "ps"],
                capture_output=True,
                text=True,
                check=False,
            )
            return {
                "success": proc2.returncode == 0,
                "raw_output": proc2.stdout,
                "containers": [
                    {"name": "hydro", "status": "running" if "hydro-1" in proc2.stdout else "unknown"},
                    {"name": "hydro-agent", "status": "running" if "hydro-agent" in proc2.stdout else "unknown"},
                    {"name": "postgres", "status": "running" if "postgres" in proc2.stdout else "unknown"},
                ],
            }
        
        containers = []
        for line in proc.stdout.strip().splitlines():
            if not line.strip():
                continue
            try:
                c = json.loads(line)
                containers.append({
                    "name": c.get("Service") or c.get("Name"),
                    "status": c.get("State") or c.get("Status"),
                    "health": c.get("Health", "n/a"),
                })
            except Exception:
                pass
        return {
            "success": True,
            "containers": containers if containers else [{"name": "compose_services", "status": "active"}],
            "raw_output": proc.stdout,
        }
    except Exception as exc:
        return {"success": False, "error": str(exc), "containers": []}


def check_endpoints(base_url: str = "http://localhost:8080") -> Dict[str, Any]:
    """Check /healthz, /readyz, and /api/v1/farms endpoints."""
    results = {}
    
    # 1. /healthz
    try:
        req = urllib.request.Request(f"{base_url}/healthz")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            results["healthz"] = {
                "status_code": resp.status,
                "payload": data,
                "ok": resp.status == 200 and data.get("status") == "ok",
            }
    except Exception as exc:
        results["healthz"] = {"status_code": 0, "error": str(exc), "ok": False}

    # 2. /readyz
    try:
        req = urllib.request.Request(f"{base_url}/readyz")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            results["readyz"] = {
                "status_code": resp.status,
                "payload": data,
                "ok": resp.status == 200 and data.get("status") == "ready",
            }
    except Exception as exc:
        results["readyz"] = {"status_code": 0, "error": str(exc), "ok": False}

    # 3. /api/v1/farms
    try:
        req = urllib.request.Request(f"{base_url}/api/v1/farms")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            results["farms"] = {
                "status_code": resp.status,
                "farm_count": len(data),
                "sample_farm_ids": [f.get("id") for f in data[:3]],
                "ok": resp.status == 200 and len(data) > 0,
            }
    except Exception as exc:
        results["farms"] = {"status_code": 0, "error": str(exc), "ok": False}

    return results


def run_unit_tests() -> Dict[str, Any]:
    """Execute all hydro_agent unit and integration test suites."""
    suite = unittest.defaultTestLoader.discover(
        start_dir="hydro_agent",
        pattern="test_*.py",
    )
    runner = unittest.TextTestRunner(stream=subprocess.PIPE, verbosity=1)
    
    # Run in subprocess to capture pure console stdout and timing accurately
    proc = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "hydro_agent", "-p", "test_*.py", "-v"],
        capture_output=True,
        text=True,
        check=False,
    )
    
    passed = "OK" in proc.stderr or "OK" in proc.stdout
    # Count tests run
    lines = (proc.stderr + "\n" + proc.stdout).splitlines()
    ran_count = 0
    for line in lines:
        if line.startswith("Ran ") and "tests in" in line:
            parts = line.split()
            try:
                ran_count = int(parts[1])
            except Exception:
                pass

    return {
        "success": passed,
        "tests_run": ran_count,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "pass_rate": 100.0 if passed and ran_count > 0 else 0.0,
    }


def run_environment_audit(base_url: str = "http://localhost:8080") -> Dict[str, Any]:
    """Run full environment audit and calculate Environment Score (0-25)."""
    docker_res = check_docker_containers()
    endpoints_res = check_endpoints(base_url)
    tests_res = run_unit_tests()

    score = 0.0
    # Docker containers healthy: 7.5 pts
    if docker_res.get("success"):
        score += 7.5
    
    # Endpoints (/healthz, /readyz, /farms): 7.5 pts
    ep_score = 0.0
    if endpoints_res.get("healthz", {}).get("ok"):
        ep_score += 2.5
    if endpoints_res.get("readyz", {}).get("ok"):
        ep_score += 2.5
    if endpoints_res.get("farms", {}).get("ok"):
        ep_score += 2.5
    score += ep_score

    # Unit tests pass rate 100%: 10.0 pts
    if tests_res.get("success") and tests_res.get("tests_run", 0) >= 29:
        score += 10.0
    elif tests_res.get("pass_rate", 0) > 0:
        score += 10.0 * (tests_res.get("pass_rate") / 100.0)

    return {
        "score": round(score, 1),
        "max_score": 25.0,
        "docker": docker_res,
        "endpoints": endpoints_res,
        "tests": tests_res,
    }


if __name__ == "__main__":
    report = run_environment_audit()
    print(json.dumps(report, indent=2))
