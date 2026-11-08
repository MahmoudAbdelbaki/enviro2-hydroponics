package safety

import (
	"fmt"
	"math"

	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/physics"
)

// Violation describes why the deterministic Go safety guardian rejected an ML actuation command.
type Violation struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (v *Violation) Error() string {
	return fmt.Sprintf("%s: %s", v.Code, v.Message)
}

// CheckCommand evaluates the 5 deterministic PLC safety interlocks against the current
// physical state and farm configuration before any ML command is allowed to mutate state.
func CheckCommand(
	cfg physics.Config,
	st physics.State,
	req domain.CommandRequest,
	lastChemDoseSimSec *float64,
	stepSec float64,
) (domain.Actuation, *Violation) {
	// Rule 1: Sanity & Finite Bounds
	vals := []float64{req.DoseStockAML, req.DoseStockBML, req.DoseAcidML, req.DoseBaseML, req.RefillWaterL}
	for _, v := range vals {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return domain.Actuation{}, &Violation{
				Code:    "INVALID_BOUNDS",
				Message: "all dosing and refill volumes must be finite and non-negative",
			}
		}
	}
	if req.Throttle != nil {
		th := *req.Throttle
		if math.IsNaN(th) || math.IsInf(th, 0) || th < 0.0 || th > 1.0 {
			return domain.Actuation{}, &Violation{
				Code:    "INVALID_BOUNDS",
				Message: fmt.Sprintf("actuator throttle %.3f must be within [0.0, 1.0]", th),
			}
		}
	}

	var act domain.Actuation
	switch req.Action {
	case domain.ActionSetPumpThrottle:
		if req.Throttle == nil {
			return domain.Actuation{}, &Violation{Code: "INVALID_BOUNDS", Message: "throttle is required for set_pump_throttle"}
		}
		// Dry-run pump protection: do not allow full pump speed if reservoir is at dead volume
		if st.VResM3 <= cfg.VResDeadM3 && *req.Throttle > 0 {
			return domain.Actuation{}, &Violation{
				Code:    "DRY_PUMP_INTERLOCK",
				Message: "cannot engage circulation pump when reservoir volume is at or below dead volume",
			}
		}
		act.PumpThrottle = req.Throttle
		return act, nil

	case domain.ActionSetAeratorThrottle:
		if req.Throttle == nil {
			return domain.Actuation{}, &Violation{Code: "INVALID_BOUNDS", Message: "throttle is required for set_aerator_throttle"}
		}
		act.AeratorThrottle = req.Throttle
		return act, nil

	case domain.ActionSetFanThrottle:
		if req.Throttle == nil {
			return domain.Actuation{}, &Violation{Code: "INVALID_BOUNDS", Message: "throttle is required for set_fan_throttle"}
		}
		act.FanThrottle = req.Throttle
		return act, nil

	case domain.ActionRefillWater, domain.ActionDose:
		// Handled below
	default:
		return domain.Actuation{}, &Violation{
			Code:    "UNSUPPORTED_ACTION",
			Message: fmt.Sprintf("unsupported command action %q", req.Action),
		}
	}

	// Convert mL (10^-6 m^3) and L (10^-3 m^3) to SI m^3
	vA := req.DoseStockAML * 1e-6
	vB := req.DoseStockBML * 1e-6
	vAcid := req.DoseAcidML * 1e-6
	vBase := req.DoseBaseML * 1e-6
	vRefill := req.RefillWaterL * 1e-3

	vChemTot := vA + vB + vAcid + vBase
	vAddTot := vChemTot + vRefill
	if vAddTot <= 0 {
		return domain.Actuation{}, &Violation{
			Code:    "INVALID_BOUNDS",
			Message: "dosing or refill command must specify a positive volume",
		}
	}

	// Rule 2: Tank Overflow Interlock (Module 2)
	if st.VResM3+vAddTot > cfg.VResMaxM3+1e-9 {
		return domain.Actuation{}, &Violation{
			Code: "TANK_OVERFLOW_RISK",
			Message: fmt.Sprintf("adding %.2f L to current reservoir volume %.2f L exceeds max capacity %.2f L",
				vAddTot*1000.0, st.VResM3*1000.0, cfg.VResMaxM3*1000.0),
		}
	}

	vTotCurr := math.Max(1e-6, st.VResM3+st.VChTotM3)
	vTotAfter := vTotCurr + vAddTot

	if vChemTot > 0 {
		// Rule 3: Hydraulic Mixing Cooldown Interlock (Section 13 Table: tau_loop = V_res / Q_pump)
		qPumpCurr := cfg.EtaPump0 * st.PumpThrottle * cfg.QPumpRatedM3S
		tauLoop := 300.0
		if qPumpCurr > 1e-9 {
			tauLoop = st.VResM3 / qPumpCurr
		}
		cooldownSec := math.Max(stepSec, 0.5*tauLoop)
		if lastChemDoseSimSec != nil && (st.SimTimeSec-*lastChemDoseSimSec) < cooldownSec-1e-6 {
			return domain.Actuation{}, &Violation{
				Code: "MIXING_COOLDOWN_ACTIVE",
				Message: fmt.Sprintf("chemical dosing cooldown active: %.0fs elapsed since last dose, require >= %.0fs (0.5 * tau_loop) for hydraulic mixing",
					st.SimTimeSec-*lastChemDoseSimSec, cooldownSec),
			}
		}

		// Rule 4: Single-Command Shock Cap (max |Delta[Alk]| <= 0.50 meq/L)
		deltaAlk := math.Abs(vAcid*cfg.StockAcidAlk+vBase*cfg.StockBaseAlk) / vTotAfter
		if deltaAlk > 0.50 {
			return domain.Actuation{}, &Violation{
				Code: "SINGLE_DOSE_CAP_EXCEEDED",
				Message: fmt.Sprintf("single acid/base dose shifts reservoir alkalinity by %.2f meq/L, exceeding safety cap of 0.50 meq/L",
					deltaAlk),
			}
		}
	}

	// Rule 5: Pre-Dose Equilibrium Speciation Dry-Run (Modules 3 & 4)
	var postIons physics.IonVec
	for i := 0; i < physics.NumIons; i++ {
		mNew := st.MolesMol[i] +
			vRefill*cfg.SrcIonsMolM3[i] +
			vA*cfg.StockAIons[i] +
			vB*cfg.StockBIons[i] +
			vAcid*cfg.StockAcidIons[i] +
			vBase*cfg.StockBaseIons[i]
		postIons[i] = math.Max(0, mNew/vTotAfter)
	}
	alkAfter := (st.AlkMol +
		vRefill*cfg.SrcAlkEqM3 +
		vA*cfg.StockAAlk +
		vB*cfg.StockBAlk +
		vAcid*cfg.StockAcidAlk +
		vBase*cfg.StockBaseAlk) / vTotAfter
	dicAfter := (st.DICMol + vRefill*cfg.SrcDICMolM3) / vTotAfter

	iStrAfter := physics.IonicStrengthMolL(postIons)
	phAfter, hMolAfter := physics.SolveEquilibriumPH(alkAfter, dicAfter, postIons[physics.IonP], postIons[physics.IonNH4], iStrAfter)
	ec25After, _ := physics.ComputeEC(postIons, dicAfter, phAfter, hMolAfter, st.TResC)

	if vChemTot > 0 && (ec25After-st.EC25dSm) > 0.40 {
		return domain.Actuation{}, &Violation{
			Code: "SINGLE_DOSE_CAP_EXCEEDED",
			Message: fmt.Sprintf("single nutrient dose raises EC25 by +%.2f dS/m (from %.2f to %.2f dS/m), exceeding single-shot cap of +0.40 dS/m",
				ec25After-st.EC25dSm, st.EC25dSm, ec25After),
		}
	}

	if phAfter < 4.5 || phAfter > 7.8 {
		return domain.Actuation{}, &Violation{
			Code: "PREDICTED_PH_OUT_OF_ENVELOPE",
			Message: fmt.Sprintf("speciation dry-run rejected command: predicted post-mix pH %.2f is outside safe physiological envelope [4.50, 7.80]",
				phAfter),
		}
	}
	if ec25After > 4.0 {
		return domain.Actuation{}, &Violation{
			Code: "PREDICTED_EC_OUT_OF_ENVELOPE",
			Message: fmt.Sprintf("speciation dry-run rejected command: predicted post-mix EC25 %.2f dS/m exceeds maximum safe limit 4.00 dS/m",
				ec25After),
		}
	}

	act = domain.Actuation{
		DoseStockAM3:  vA,
		DoseStockBM3:  vB,
		DoseAcidM3:    vAcid,
		DoseBaseM3:    vBase,
		RefillWaterM3: vRefill,
	}
	return act, nil
}
