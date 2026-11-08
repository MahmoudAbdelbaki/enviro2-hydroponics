package validate_test

import (
	"testing"

	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/validate"
)

func TestValidateFarm_TableDriven(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		mutate         func(f *domain.FarmSpec)
		wantValid      bool
		wantCompIDs    []string
		wantErrorCodes []string
	}{
		{
			name:      "default demo farm is completely valid",
			mutate:    func(_ *domain.FarmSpec) {},
			wantValid: true,
		},
		{
			name: "invalid channel slope S_0 > 0.05 and reservoir max_volume < initial_volume (Act 1 Demo)",
			mutate: func(f *domain.FarmSpec) {
				f.Channels[1].Slope = 0.09 // ch-2 invalid slope
				f.Reservoir.MaxVolumeL = 100.0 // < 250.0 initial_volume_l
			},
			wantValid:      false,
			wantCompIDs:    []string{"reservoir-1", "ch-2"},
			wantErrorCodes: []string{"GEOMETRY_CONFLICT", "PHYSICS_RANGE_VIOLATION"},
		},
		{
			name: "coupled enclosure footprint smaller than total channel area",
			mutate: func(f *domain.FarmSpec) {
				// 3 channels * 2.0m * 0.10m = 0.60 m^2
				f.Enclosure.FloorAreaM2 = 0.40
			},
			wantValid:      false,
			wantCompIDs:    []string{"enclosure-1"},
			wantErrorCodes: []string{"GEOMETRY_CONFLICT"},
		},
		{
			name: "plant spacing * plants_per_channel exceeds channel length",
			mutate: func(f *domain.FarmSpec) {
				for i := range f.Channels {
					f.Channels[i].PlantsPerChannel = 20
					f.Channels[i].PlantSpacingM = 0.20 // 20 * 0.20 = 4.0m > 2.0m
				}
			},
			wantValid:      false,
			wantCompIDs:    []string{"ch-1", "ch-2", "ch-3"},
			wantErrorCodes: []string{"GEOMETRY_CONFLICT"},
		},
		{
			name: "duplicate component ID and dangling sensor attachment",
			mutate: func(f *domain.FarmSpec) {
				f.Pump.ID = "reservoir-1" // duplicate
				f.Sensors[0].AttachedToID = "ghost-pipe-99"
			},
			wantValid:      false,
			wantCompIDs:    []string{"reservoir-1", "sen-ec-1"},
			wantErrorCodes: []string{"DUPLICATE_COMPONENT_ID", "UNKNOWN_COMPONENT_REF"},
		},
		{
			name: "excessive pump flow violates Manning shallow sheet-flow depth limit (> 25 mm)",
			mutate: func(f *domain.FarmSpec) {
				f.Pump.RatedFlowLMin = 900.0 // huge flood flow
			},
			wantValid:      false,
			wantCompIDs:    []string{"pump-1"},
			wantErrorCodes: []string{"HYDRAULIC_FILM_DEPTH_VIOLATION"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			spec := domain.DefaultDemoFarm()
			tc.mutate(&spec)

			issues := validate.Farm(spec)
			gotValid := len(issues) == 0
			if gotValid != tc.wantValid {
				t.Fatalf("got valid=%v, want %v; issues=%+v", gotValid, tc.wantValid, issues)
			}

			compSet := make(map[string]bool)
			codeSet := make(map[string]bool)
			for _, iss := range issues {
				compSet[iss.ComponentID] = true
				codeSet[iss.Code] = true
			}
			for _, wantComp := range tc.wantCompIDs {
				if !compSet[wantComp] {
					t.Errorf("missing expected offending component_id %q in issues %+v", wantComp, issues)
				}
			}
			for _, wantCode := range tc.wantErrorCodes {
				if !codeSet[wantCode] {
					t.Errorf("missing expected error code %q in issues %+v", wantCode, issues)
				}
			}
		})
	}
}
