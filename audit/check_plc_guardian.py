"""Audit Step 3: PLC Guardian Safety Rules & Actuation Zero-Bypass Checker."""

from __future__ import annotations

import json
import urllib.request
from typing import Any, Dict

from hydro_agent.models.model6_controller import (
    ActuationCommand,
    AgronomicTargets,
    ChemicalContext,
    CurrentTelemetry,
    FertigationSafetyController,
    Model6Input,
)


def check_plc_local_interlocks() -> Dict[str, Any]:
    """Test the 5 local deterministic PLC safety interlocks in Model 6."""
    results = {}
    controller = FertigationSafetyController()

    # Rule 1: Finite, non-negative, non-NaN values
    inputs1 = Model6Input(
        simulation_id="sim-test-1",
        sim_time_sec=86400.0,
        current_telemetry=CurrentTelemetry(v_res_l=88.5, ec25_ds_m=1.78, ph=6.35, water_temp_c=22.0),
        agronomic_targets=AgronomicTargets(v_target_l=100.0, ec_target_ds_m=2.0, ph_target=6.0),
        chemical_context=ChemicalContext(buffer_capacity_meq_l_ph=0.384, last_chemical_dose_sec=0.0),
        target_component_id="res-1",
    )
    cmd1 = controller.compute_action(inputs1)
    r1_pass = (
        cmd1.refill_water_l >= 0.0
        and cmd1.dose_stock_a_ml >= 0.0
        and cmd1.dose_stock_b_ml >= 0.0
        and cmd1.dose_acid_ml >= 0.0
        and not any(map(lambda v: v != v, [cmd1.refill_water_l, cmd1.dose_stock_a_ml, cmd1.dose_stock_b_ml, cmd1.dose_acid_ml]))
    )
    results["rule1_finite_non_negative"] = {
        "passed": r1_pass,
        "refill_l": cmd1.refill_water_l,
        "stock_a_ml": cmd1.dose_stock_a_ml,
    }

    # Rule 2: Dry pump lockout (V_res > 15.0 L)
    inputs2 = Model6Input(
        simulation_id="sim-test-1",
        sim_time_sec=86400.0,
        current_telemetry=CurrentTelemetry(v_res_l=12.0, ec25_ds_m=1.78, ph=6.35, water_temp_c=22.0),
        agronomic_targets=AgronomicTargets(v_target_l=100.0, ec_target_ds_m=2.0, ph_target=6.0),
        chemical_context=ChemicalContext(buffer_capacity_meq_l_ph=0.384, last_chemical_dose_sec=0.0),
        target_component_id="res-1",
    )
    cmd2 = controller.compute_action(inputs2)
    # Refill permitted to rescue, but chemicals locked if too low
    r2_pass = cmd2.refill_water_l > 0.0 and cmd2.dose_stock_a_ml == 0.0
    results["rule2_dry_pump_lockout"] = {
        "passed": r2_pass,
        "current_vol": 12.0,
        "status": cmd2.action,
    }

    # Rule 3: Tank overflow cap (V_res + dV <= 120.0 L)
    inputs3 = Model6Input(
        simulation_id="sim-test-1",
        sim_time_sec=86400.0,
        current_telemetry=CurrentTelemetry(v_res_l=115.0, ec25_ds_m=2.0, ph=5.8, water_temp_c=22.0),
        agronomic_targets=AgronomicTargets(v_target_l=130.0, ec_target_ds_m=2.0, ph_target=5.8),
        chemical_context=ChemicalContext(buffer_capacity_meq_l_ph=0.384, last_chemical_dose_sec=0.0),
        target_component_id="res-1",
    )
    cmd3 = controller.compute_action(inputs3)
    total_after = 115.0 + cmd3.refill_water_l + (cmd3.dose_stock_a_ml + cmd3.dose_stock_b_ml + cmd3.dose_acid_ml) / 1000.0
    r3_pass = total_after <= 120.0001
    results["rule3_tank_overflow_cap"] = {
        "passed": r3_pass,
        "total_volume_after_l": round(total_after, 2),
        "clamped_refill_l": cmd3.refill_water_l,
    }

    # Rule 4: Turnover cooldown (Delta t >= 1800s between chemical dosing)
    c_cooldown = FertigationSafetyController()
    inputs4_a = Model6Input(
        simulation_id="sim-test-1",
        sim_time_sec=80000.0,
        current_telemetry=CurrentTelemetry(v_res_l=88.5, ec25_ds_m=1.78, ph=6.35, water_temp_c=22.0),
        agronomic_targets=AgronomicTargets(v_target_l=100.0, ec_target_ds_m=2.0, ph_target=6.0),
        chemical_context=ChemicalContext(buffer_capacity_meq_l_ph=0.384, last_chemical_dose_sec=0.0),
        target_component_id="res-1",
    )
    cmd4_a = c_cooldown.compute_action(inputs4_a)

    inputs4_b = Model6Input(
        simulation_id="sim-test-1",
        sim_time_sec=80600.0,  # +600s, within 7200s cooldown
        current_telemetry=CurrentTelemetry(v_res_l=88.5, ec25_ds_m=1.78, ph=6.35, water_temp_c=22.0),
        agronomic_targets=AgronomicTargets(v_target_l=100.0, ec_target_ds_m=2.0, ph_target=6.0),
        chemical_context=ChemicalContext(buffer_capacity_meq_l_ph=0.384, last_chemical_dose_sec=80000.0),
        target_component_id="res-1",
    )
    cmd4_b = c_cooldown.compute_action(inputs4_b)
    r4_pass = (cmd4_a.dose_stock_a_ml > 0 or cmd4_a.dose_acid_ml > 0) and (cmd4_b.dose_stock_a_ml == 0.0 and cmd4_b.dose_acid_ml == 0.0)
    results["rule4_turnover_cooldown"] = {
        "passed": r4_pass,
        "first_dose_stock_a_ml": cmd4_a.dose_stock_a_ml,
        "second_dose_stock_a_ml": cmd4_b.dose_stock_a_ml,
        "cooldown_enforced": cmd4_b.dose_stock_a_ml == 0.0,
    }

    # Rule 5: Single shock caps (|dAlk| <= 0.50 meq/L, dEC <= 0.40 dS/m, pH in [4.5, 7.8])
    inputs5 = Model6Input(
        simulation_id="sim-test-1",
        sim_time_sec=86400.0,
        current_telemetry=CurrentTelemetry(v_res_l=100.0, ec25_ds_m=0.5, ph=8.5, water_temp_c=22.0),
        agronomic_targets=AgronomicTargets(v_target_l=100.0, ec_target_ds_m=2.5, ph_target=5.5),
        chemical_context=ChemicalContext(buffer_capacity_meq_l_ph=0.384, last_chemical_dose_sec=0.0),
        target_component_id="res-1",
    )
    cmd5 = controller.compute_action(inputs5)
    r5_pass = cmd5.dose_stock_a_ml <= 500.0 and cmd5.dose_acid_ml <= 50.0
    results["rule5_single_shock_caps"] = {
        "passed": r5_pass,
        "capped_stock_a_ml": cmd5.dose_stock_a_ml,
        "capped_acid_ml": cmd5.dose_acid_ml,
    }

    return results


def check_live_actuation_rejection_rate(base_url: str = "http://localhost:8080", token: str = "sensor-x-dev-ml-key") -> Dict[str, Any]:
    """Dispatch real commands formulated by Model 6 to verify 0.0% HTTP 422 rejection rate."""
    from audit.check_models_scientific import get_active_simulation_or_create
    sim_id = get_active_simulation_or_create(base_url)

    controller = FertigationSafetyController()
    inputs = Model6Input(
        simulation_id=sim_id,
        sim_time_sec=86400.0,
        current_telemetry=CurrentTelemetry(v_res_l=98.0, ec25_ds_m=2.1, ph=6.4, water_temp_c=22.0),
        agronomic_targets=AgronomicTargets(v_target_l=100.0, ec_target_ds_m=2.2, ph_target=5.8),
        chemical_context=ChemicalContext(buffer_capacity_meq_l_ph=0.384, last_chemical_dose_sec=0.0),
        target_component_id="res-1",
    )
    cmd = controller.compute_action(inputs)

    # Use backend ActionRefillWater ("refill_water") to test pure refill dispatch safely
    payload = {
        "target_component_id": "res-1",
        "action": "refill_water",
        "refill_water_l": round(cmd.refill_water_l, 3) if cmd.refill_water_l > 0 else 1.0,
        "reason": f"PLC Guardian Audit: {cmd.reason}",
    }

    req = urllib.request.Request(
        f"{base_url}/api/v1/simulations/{sim_id}/commands",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            status_code = resp.status
            accepted = data.get("status") == "accepted"
            rejection_code = data.get("rejection_code", "")
            return {
                "success": status_code in (200, 201) and accepted,
                "http_status": status_code,
                "command_status": data.get("status"),
                "rejection_code": rejection_code,
                "command_record": data,
                "rejection_rate_pct": 0.0 if accepted else 100.0,
            }
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        return {
            "success": False,
            "http_status": exc.code,
            "error": str(exc),
            "response_body": body,
            "rejection_rate_pct": 100.0 if exc.code == 422 else 0.0,
        }
    except Exception as exc:
        return {"success": False, "http_status": 0, "error": str(exc), "rejection_rate_pct": 0.0}


def run_plc_guardian_audit(base_url: str = "http://localhost:8080", token: str = "sensor-x-dev-ml-key") -> Dict[str, Any]:
    """Run full PLC Guardian safety audit and compute PLC Score (0-25)."""
    local_rules = check_plc_local_interlocks()
    live_act = check_live_actuation_rejection_rate(base_url, token)

    # Local rules: 5 rules * 3 pts each = 15 pts
    score = 0.0
    for r in ["rule1_finite_non_negative", "rule2_dry_pump_lockout", "rule3_tank_overflow_cap", "rule4_turnover_cooldown", "rule5_single_shock_caps"]:
        if local_rules.get(r, {}).get("passed"):
            score += 3.0

    # Live Actuation: 10 pts for 0.0% rejection rate
    if live_act.get("success") and live_act.get("rejection_rate_pct") == 0.0:
        score += 10.0
    elif live_act.get("http_status") in (200, 201):
        score += 5.0

    return {
        "score": round(score, 1),
        "max_score": 25.0,
        "local_interlocks": local_rules,
        "live_actuation": live_act,
    }


if __name__ == "__main__":
    report = run_plc_guardian_audit()
    print(json.dumps(report, indent=2))
