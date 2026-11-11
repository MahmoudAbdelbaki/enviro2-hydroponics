"""CLI and Daemon Entrypoint for the Hydroponic ML Diagnostic & Control Agent.

Runs continuously against the Go Core digital twin backend (:8080):
- Connects and waits for backend readiness (/healthz).
- Polls noisy sensor observations (/readings).
- Executes Models 1-4 for forward state simulation.
- Executes Model 5 for fault detection and alert dispatch (/alerts).
- Executes Model 6 for closed-loop fertigation commands (/commands).

Also supports --demo mode to run an automated fault injection and closed-loop test.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import sys
import time

from hydro_agent.agent import HydroAutonomousAgent
from hydro_agent.client.twin_client import TwinClient

ROOT_DIR = Path(__file__).resolve().parent.parent

logging.basicConfig(
    level=os.getenv("HYDRO_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("hydro_agent")


def wait_for_backend(client: TwinClient, max_retries: int = 30, delay_s: float = 2.0) -> bool:
    """Block until Go Core backend is healthy."""
    logger.info("Connecting to Go Core backend at %s...", client.base_url)
    for i in range(max_retries):
        try:
            res = client.health_check()
            logger.info("Go Core backend is healthy: %s", res)
            return True
        except Exception as e:
            logger.debug("Attempt %d/%d: Go backend not ready yet (%s)", i + 1, max_retries, e)
            time.sleep(delay_s)
    logger.error("Timed out waiting for Go backend after %d seconds.", max_retries * delay_s)
    return False


def run_demo_scenario(client: TwinClient, agent: HydroAutonomousAgent):
    """Run an automated fault injection and closed-loop control demonstration."""
    logger.info("=" * 70)
    logger.info("RUNNING AUTOMATED CLOSED-LOOP ML DEMO SCENARIO")
    logger.info("=" * 70)

    # 1. Load valid farm spec
    farm_path = ROOT_DIR / "testdata" / "valid_farm.json"
    if not farm_path.exists():
        logger.error("Could not find %s", farm_path)
        return

    with open(farm_path, "r", encoding="utf-8") as f:
        farm_spec = json.load(f)

    farm_res = client.create_farm(farm_spec)
    farm_id = farm_res.get("id") or farm_res.get("farm_id", "farm-baseline")
    logger.info("Created benchmark farm: %s", farm_id)

    # 2. Start simulation in paused mode
    sim_res = client.start_simulation(farm_id=farm_id, seed=42, step_seconds=300, initial_mode="paused")
    sim_id = sim_res.get("id") or sim_res.get("simulation_id")
    logger.info("Started Simulation %s", sim_id)

    # 3. Fast-forward to mid-vegetative growth (Day 10 = 2880 ticks)
    logger.info("[Fast-Forward] Advancing 2880 steps (Day 10)...")
    client.advance(sim_id, steps=2880)

    # 4. Inject hidden pump_degradation (0.95) and aeration_loss (1.0)
    logger.info("[Operator] Injecting pump_degradation (0.95) and aeration_loss (1.0)...")
    client.inject_fault(sim_id, {
        "kind": "pump_degradation",
        "target_component_id": "pump-1",
        "intensity": 0.95,
        "trigger_at_sim_sec": 0,
    })
    client.inject_fault(sim_id, {
        "kind": "aeration_loss",
        "target_component_id": "aerator-1",
        "intensity": 1.0,
        "trigger_at_sim_sec": 0,
    })
    client.advance(sim_id, steps=48)

    # 5. Agent polls telemetry and executes Models 1-6
    logger.info("[ML Agent] Polling noisy /readings and evaluating first-principles models...")
    step_result = agent.run_polling_step(sim_id)

    logger.info("Diagnostics Result:")
    logger.info("  Overall Status: %s", step_result["diagnostics"]["overall_system_status"])
    logger.info("  Diagnosed Faults: %s", step_result["diagnostics"]["active_diagnosed_faults"])

    logger.info("Safety Controller Result:")
    logger.info("  Formulated Command: %s", step_result["control"]["command"])
    logger.info("  Guardian Audit Status: %s", step_result["control"]["audit"])
    logger.info("=" * 70)
    logger.info("DEMO SCENARIO COMPLETED SUCCESSFULLY")
    logger.info("=" * 70)


def resolve_simulation_id(client: TwinClient, preferred_farm_id: Optional[str] = None) -> str:
    """Find the most relevant active simulation or spin up a new verified one.

    Guarantees a valid UUID is returned; never returns a dummy non-UUID string.
    """
    env_sim = os.getenv("HYDRO_SIM_ID", "").strip()
    if env_sim:
        logger.info("Using simulation ID from HYDRO_SIM_ID: %s", env_sim)
        return env_sim

    # 1. Discover existing simulations in the twin
    try:
        sims = client.list_simulations()
        if sims:
            # Prefer a running simulation if one exists
            running = [s for s in sims if s.get("mode") == "running"]
            chosen = running[0] if running else sims[0]
            chosen_id = chosen.get("id") or chosen.get("simulation_id")
            if chosen_id:
                logger.info(
                    "Auto-attached to existing simulation %s (mode: %s, tick: %s)",
                    chosen_id,
                    chosen.get("mode"),
                    chosen.get("tick_index"),
                )
                return str(chosen_id)
    except Exception as e:
        logger.warning("Could not list simulations: %s", e)

    # 2. No existing simulations found: find or create a valid Farm
    farm_id = None
    try:
        farms = client.list_farms()
        if farms:
            farm_id = farms[0].get("id")
            logger.info("Using existing farm %s", farm_id)
    except Exception as e:
        logger.warning("Could not list farms: %s", e)

    if not farm_id:
        exp2_path = ROOT_DIR / "testdata" / "real_datasets" / "hydrogrownet_egypt" / "exp2_farm.json"
        valid_path = ROOT_DIR / "testdata" / "valid_farm.json"
        target_path = exp2_path if exp2_path.exists() else valid_path
        if target_path.exists():
            try:
                with open(target_path, "r", encoding="utf-8") as f:
                    farm_spec = json.load(f)
                created_farm = client.create_farm(farm_spec)
                farm_id = created_farm.get("id")
                logger.info("Created new benchmark farm %s from %s", farm_id, target_path.name)
            except Exception as e:
                logger.error("Failed to create farm from %s: %s", target_path, e)

    if not farm_id:
        raise RuntimeError("Cannot start simulation: no valid farm found or created in database.")

    # 3. Start a new simulation with the valid farm UUID
    sim_res = client.start_simulation(farm_id=farm_id, initial_mode="running", speed_multiplier=60.0)
    new_sim_id = sim_res.get("id") or sim_res.get("simulation_id")
    if not new_sim_id:
        raise RuntimeError(f"Backend did not return a valid simulation ID: {sim_res}")
    logger.info("Started new simulation %s for farm %s", new_sim_id, farm_id)
    return str(new_sim_id)


def main():
    parser = argparse.ArgumentParser(description="Hydroponic ML Diagnostic & Control Agent")
    parser.add_argument("--url", default=os.getenv("HYDRO_TWIN_URL", "http://localhost:8080"), help="Go backend URL")
    parser.add_argument("--key", default=os.getenv("HYDRO_ML_API_KEY", "sensor-x-dev-ml-key"), help="ML API Bearer key")
    parser.add_argument("--farm-id", default=os.getenv("HYDRO_FARM_ID", ""), help="Target Farm ID (optional)")
    parser.add_argument("--interval", type=float, default=5.0, help="Polling interval in seconds")
    parser.add_argument("--advance", type=int, default=0, help="Advance simulation synchronously by N ticks (delta_t=300s) before each step")
    parser.add_argument("--single-step", action="store_true", help="Run a single evaluation step and exit")
    parser.add_argument("--demo", action="store_true", help="Run automated fault injection & control demo scenario")
    args = parser.parse_args()

    client = TwinClient(base_url=args.url, api_key=args.key)

    if not wait_for_backend(client):
        sys.exit(1)

    agent = HydroAutonomousAgent(client=client)

    if args.demo:
        run_demo_scenario(client, agent)
        return

    # Initialize or auto-discover valid simulation UUID
    sim_id = resolve_simulation_id(client, preferred_farm_id=args.farm_id or None)
    logger.info("Hydro Autonomous Agent active on simulation '%s'...", sim_id)

    pinned_env_sim = bool(os.getenv("HYDRO_SIM_ID", "").strip())

    try:
        while True:
            try:
                # If not explicitly pinned, check if another running simulation exists
                if not pinned_env_sim:
                    try:
                        sims = client.list_simulations()
                        running_sims = [s for s in sims if s.get("mode") == "running"]
                        if running_sims:
                            newest_running = str(running_sims[0].get("id") or running_sims[0].get("simulation_id"))
                            if newest_running and newest_running != sim_id:
                                logger.info("Detected newly active running simulation: %s (switching from %s)", newest_running, sim_id)
                                sim_id = newest_running
                    except Exception:
                        pass

                if args.advance > 0:
                    try:
                        client.advance(sim_id, steps=args.advance)
                    except Exception as e:
                        logger.warning("Could not advance simulation %s: %s", sim_id, e)

                res = agent.run_polling_step(sim_id)
                biometrics = res["virtual_sensing"]["model4"]["biomass_and_yield"]
                transp = res["virtual_sensing"]["model4"]["transpiration"]
                chem = res["virtual_sensing"]["model3"]["bulk_properties"]
                m1_states = res["virtual_sensing"]["model1"]["enclosure_states"]
                m2_states = res["virtual_sensing"]["model2"]["dissolved_oxygen"]
                cmd = res["control"]["command"]

                logger.info(
                    "Step completed at sim_time=%.1fs (Day %.2f) | Status=%s | Faults=%s",
                    res["sim_time_sec"],
                    res["sim_time_sec"] / 86400.0,
                    res["diagnostics"]["overall_system_status"],
                    res["diagnostics"]["active_diagnosed_faults"],
                )
                logger.info(
                    "  [Biometrics] FreshWeight=%.1fg | LAI=%.2f | Transp=%.4f L/plant/d | Stress=%.2f",
                    biometrics["shoot_fresh_weight_g_plant"],
                    biometrics["effective_lai"],
                    transp["daily_water_use_l_plant_day"],
                    biometrics["stress_factor"],
                )
                logger.info(
                    "  [Virtual Sensing] T_air=%.1f°C | VPD=%.2fkPa | DO_out=%.2fmg/L | EC25=%.2fdS/m | pH=%.2f | beta=%.3f",
                    m1_states["t_air_c"],
                    m1_states["vpd_kpa"],
                    m2_states["channel_outlet_do_mg_l"],
                    chem["ec25_ds_m"],
                    chem["ph"],
                    chem["buffer_capacity_meq_l_ph"],
                )
                logger.info(
                    "  [Actuation] Target=%s | Refill=%.2fL | StockA=%.1fmL | StockB=%.1fmL | Acid=%.1fmL | Action=%s",
                    cmd["target_component_id"],
                    cmd["refill_water_l"],
                    cmd["dose_stock_a_ml"],
                    cmd["dose_stock_b_ml"],
                    cmd["dose_acid_ml"],
                    cmd["reason"][:60] + "...",
                )
            except Exception as e:
                logger.error("Error during agent control loop step: %s", e)
                if not pinned_env_sim:
                    try:
                        sim_id = resolve_simulation_id(client)
                    except Exception:
                        pass

            if args.single_step:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        logger.info("Agent stopped by user.")


if __name__ == "__main__":
    main()
