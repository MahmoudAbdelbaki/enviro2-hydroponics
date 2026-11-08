package safety_test

import (
	"math"
	"testing"

	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/physics"
	"github.com/abdelbaky/hydro/internal/safety"
)

func TestSafetyGuardian_AllFiveRules(t *testing.T) {
	t.Parallel()
	spec := domain.DefaultDemoFarm()
	cfg := physics.FromFarmSpec(spec)
	eng := physics.NewEngine()
	st := eng.InitState(cfg)
	st.SimTimeSec = 3600.0

	tests := []struct {
		name         string
		req          domain.CommandRequest
		lastDoseTime *float64
		wantCode     string
	}{
		{
			name: "valid moderate acid + nutrient dose is accepted",
			req: domain.CommandRequest{
				TargetComponentID: "reservoir-1",
				Action:            domain.ActionDose,
				DoseStockAML:      40.0,
				DoseStockBML:      40.0,
				DoseAcidML:        15.0,
				Reason:            "routine pH and EC maintenance",
			},
			wantCode: "",
		},
		{
			name: "Rule 1: negative or NaN volume rejected",
			req: domain.CommandRequest{
				TargetComponentID: "reservoir-1",
				Action:            domain.ActionDose,
				DoseAcidML:        -10.0,
				Reason:            "buggy ML output",
			},
			wantCode: "INVALID_BOUNDS",
		},
		{
			name: "Rule 1b: NaN value rejected",
			req: domain.CommandRequest{
				TargetComponentID: "reservoir-1",
				Action:            domain.ActionDose,
				DoseAcidML:        math.NaN(),
				Reason:            "NaN ML output",
			},
			wantCode: "INVALID_BOUNDS",
		},
		{
			name: "Rule 2: tank overflow rejected (250L + 60L > 300L max)",
			req: domain.CommandRequest{
				TargetComponentID: "reservoir-1",
				Action:            domain.ActionRefillWater,
				RefillWaterL:      60.0,
				Reason:            "over-refill",
			},
			wantCode: "TANK_OVERFLOW_RISK",
		},
		{
			name: "Rule 3: hydraulic mixing cooldown blocks back-to-back chemical doses",
			req: domain.CommandRequest{
				TargetComponentID: "reservoir-1",
				Action:            domain.ActionDose,
				DoseAcidML:        10.0,
				Reason:            "double dose before mixing",
			},
			lastDoseTime: func() *float64 { v := 3500.0; return &v }(), // only 100s ago (< 300s step / 0.5 tau_loop)
			wantCode:     "MIXING_COOLDOWN_ACTIVE",
		},
		{
			name: "Rule 4: single-shot acid shock cap (> 0.50 meq/L shift) rejected",
			req: domain.CommandRequest{
				TargetComponentID: "reservoir-1",
				Action:            domain.ActionDose,
				DoseAcidML:        500.0, // 0.5 L of 0.5M nitric acid in 250 L = 1.0 meq/L shift!
				Reason:            "drifted pH sensor tricked ML into massive acid dump",
			},
			wantCode: "SINGLE_DOSE_CAP_EXCEEDED",
		},
		{
			name: "Rule 5: equilibrium speciation dry-run blocks dose that drops pH below 4.5",
			req: domain.CommandRequest{
				TargetComponentID: "reservoir-1",
				Action:            domain.ActionDose,
				DoseAcidML:        245.0, // within 0.50 meq/L cap (0.488 meq/L), but pushes pH < 4.5!
				Reason:            "acid dose pushing below pH 4.5",
			},
			wantCode: "PREDICTED_PH_OUT_OF_ENVELOPE",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, viol := safety.CheckCommand(cfg, st, tc.req, tc.lastDoseTime, 300.0)
			if tc.wantCode == "" {
				if viol != nil {
					t.Fatalf("expected command to be accepted, got violation: %+v", viol)
				}
			} else {
				if viol == nil {
					t.Fatalf("expected violation code %q, but command was accepted", tc.wantCode)
				}
				if viol.Code != tc.wantCode {
					t.Fatalf("got violation code %q (%s), want %q", viol.Code, viol.Message, tc.wantCode)
				}
			}
		})
	}
}
