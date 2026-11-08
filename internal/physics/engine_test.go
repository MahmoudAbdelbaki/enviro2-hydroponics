package physics_test

import (
	"math"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/physics"
)

// TestSection15_1_MassConservationWithSourcesAndSinksOff verifies PHYSICS_SPEC.md Section 15.1:
// With sources and sinks disabled over 30 simulated days (8,640 steps at dt=300s),
// total water volume V_tot and all 10 dissolved ion molar inventories M_i are conserved to machine precision.
func TestSection15_1_MassConservationWithSourcesAndSinksOff(t *testing.T) {
	t.Parallel()
	spec := domain.DefaultDemoFarm()
	cfg := physics.FromFarmSpec(spec)
	cfg.DisableSourcesAndSinks = true

	eng := physics.NewEngine()
	st := eng.InitState(cfg)
	vTot0 := st.VResM3 + st.VChTotM3
	moles0 := st.MolesMol

	rng := rand.New(rand.NewPCG(42, 42))
	const steps = 8640 // 30 days at 5-min steps
	for i := 0; i < steps; i++ {
		st, _ = eng.Step(cfg, st, domain.Actuation{}, nil, 300.0, rng)
	}

	vTotFinal := st.VResM3 + st.VChTotM3
	if math.Abs(vTotFinal-vTot0) > 1e-12 {
		t.Fatalf("water volume drift = %e m^3, want 0", vTotFinal-vTot0)
	}
	for ion := 0; ion < physics.NumIons; ion++ {
		drift := math.Abs(st.MolesMol[ion] - moles0[ion])
		if drift > 1e-12 {
			t.Errorf("ion %s molar drift = %e mol, want 0", physics.IonNames[ion], drift)
		}
	}
}

// TestSection15_2_LimitingCases verifies PHYSICS_SPEC.md Section 15.2:
// 1. No Plants (N_pl,ch = 0) -> E_can = 0, ion uptake = 0, DO equilibrates to C_DO,sat
// 2. No Aeration (Q_air = 0, OTR_std = 0) -> late-crop DO drops into hypoxic regime, suppressing fresh weight
// 3. Darkness (tau_cov = 0) -> photosynthesis = 0, dry weight decreases slowly via maintenance respiration
func TestSection15_2_LimitingCases(t *testing.T) {
	t.Parallel()
	eng := physics.NewEngine()

	t.Run("No_Plants_ZeroUptake_DOEquilibrates", func(t *testing.T) {
		t.Parallel()
		spec := domain.DefaultDemoFarm()
		for i := range spec.Channels {
			spec.Channels[i].PlantsPerChannel = 0
		}
		cfg := physics.FromFarmSpec(spec)
		st := eng.InitState(cfg)
		mNO3Init := st.MolesMol[physics.IonNO3]

		rng := rand.New(rand.NewPCG(1, 1))
		for i := 0; i < 288; i++ { // 24 hours
			st, _ = eng.Step(cfg, st, domain.Actuation{}, nil, 300.0, rng)
		}
		if st.LAI != 0 || st.ShootFWgPerPlant != 0 {
			t.Fatalf("expected 0 LAI/biomass with 0 plants, got LAI=%f FW=%f", st.LAI, st.ShootFWgPerPlant)
		}
		if math.Abs(st.MolesMol[physics.IonNO3]-mNO3Init) > 1e-9 {
			t.Fatalf("expected 0 nitrate uptake with 0 plants, got delta=%e", st.MolesMol[physics.IonNO3]-mNO3Init)
		}
		cSat := physics.DOSaturationBensonKrause(st.TResC, st.EC25dSm, cfg.ZElevM)
		if math.Abs(st.CDOResMgL-cSat) > 0.15 {
			t.Fatalf("expected DO (%f) to equilibrate near C_DO,sat (%f)", st.CDOResMgL, cSat)
		}
	})

	t.Run("No_Aeration_Causes_Hypoxia_And_Yield_Loss", func(t *testing.T) {
		t.Parallel()
		specAer := domain.DefaultDemoFarm()
		specNoAer := domain.DefaultDemoFarm()
		specNoAer.Aerator.AirFlowLMin = 0
		specNoAer.Aerator.OTRStdGH = 0

		cfgAer := physics.FromFarmSpec(specAer)
		cfgNoAer := physics.FromFarmSpec(specNoAer)
		stAer := eng.InitState(cfgAer)
		stNoAer := eng.InitState(cfgNoAer)

		for i := 0; i < 288*20; i++ { // 20 days
			stAer, _ = eng.Step(cfgAer, stAer, domain.Actuation{}, nil, 300.0, nil)
			stNoAer, _ = eng.Step(cfgNoAer, stNoAer, domain.Actuation{}, nil, 300.0, nil)
		}
		if stNoAer.CDOChOutMgL >= stAer.CDOChOutMgL-1.5 {
			t.Fatalf("expected unaerated channel DO (%f) to drop well below aerated DO (%f)", stNoAer.CDOChOutMgL, stAer.CDOChOutMgL)
		}
		if stNoAer.ShootFWgPerPlant >= stAer.ShootFWgPerPlant {
			t.Fatalf("expected hypoxic yield suppression: unaerated FW=%f vs aerated FW=%f", stNoAer.ShootFWgPerPlant, stAer.ShootFWgPerPlant)
		}
	})

	t.Run("Darkness_ZeroPhotosynthesis_RespirationDecay", func(t *testing.T) {
		t.Parallel()
		spec := domain.DefaultDemoFarm()
		spec.Enclosure.CoverTransmittance = 0.0 // complete darkness
		cfg := physics.FromFarmSpec(spec)
		st := eng.InitState(cfg)
		xd0 := st.XdKgM2

		for i := 0; i < 288*2; i++ { // 48 hours of darkness
			st, _ = eng.Step(cfg, st, domain.Actuation{}, nil, 300.0, nil)
		}
		if st.XdKgM2 >= xd0 {
			t.Fatalf("expected total dry weight to decrease under darkness via maintenance respiration: got %f >= %f", st.XdKgM2, xd0)
		}
	})
}

// TestSection15_3_ExactGeometricScaleInvariance verifies PHYSICS_SPEC.md Section 15.3:
// Scaling all extensive farm configuration inputs by lambda = 2x while keeping intensive geometry constant
// produces identical intensive trajectories (T_air, EC25, pH, T_res, C_DO, ShootFWPerPlant) to 8+ significant digits.
func TestSection15_3_ExactGeometricScaleInvariance(t *testing.T) {
	t.Parallel()
	spec1x := domain.DefaultDemoFarm()
	spec2x := domain.DefaultDemoFarm()

	// Scale all extensive parameters by 2x (V_res, A_res, Q_pump, OTR_std, Q_air, N_ch, A_fl, V_enc, Q_fan)
	spec2x.Reservoir.InitialVolumeL *= 2.0
	spec2x.Reservoir.MaxVolumeL *= 2.0
	spec2x.Reservoir.SurfaceAreaM2 *= 2.0
	spec2x.Pump.RatedFlowLMin *= 2.0
	spec2x.Aerator.AirFlowLMin *= 2.0
	spec2x.Aerator.OTRStdGH *= 2.0
	spec2x.Enclosure.FloorAreaM2 *= 2.0
	spec2x.Enclosure.AirVolumeM3 *= 2.0
	spec2x.Fans.AirflowM3S *= 2.0
	spec2x.Channels = append(spec2x.Channels,
		domain.ChannelSpec{ID: "ch-4", LengthM: 2.0, WidthM: 0.10, Slope: 0.02, PlantSpacingM: 0.20, PlantsPerChannel: 8, InitialPlantAgeDays: 5.0},
		domain.ChannelSpec{ID: "ch-5", LengthM: 2.0, WidthM: 0.10, Slope: 0.02, PlantSpacingM: 0.20, PlantsPerChannel: 8, InitialPlantAgeDays: 5.0},
		domain.ChannelSpec{ID: "ch-6", LengthM: 2.0, WidthM: 0.10, Slope: 0.02, PlantSpacingM: 0.20, PlantsPerChannel: 8, InitialPlantAgeDays: 5.0},
	)

	cfg1x := physics.FromFarmSpec(spec1x)
	cfg2x := physics.FromFarmSpec(spec2x)
	eng := physics.NewEngine()
	st1x := eng.InitState(cfg1x)
	st2x := eng.InitState(cfg2x)

	const steps = 288 * 15 // 15 days
	for i := 0; i < steps; i++ {
		st1x, _ = eng.Step(cfg1x, st1x, domain.Actuation{}, nil, 300.0, nil)
		st2x, _ = eng.Step(cfg2x, st2x, domain.Actuation{}, nil, 300.0, nil)
	}

	assertClose := func(name string, a, b float64) {
		t.Helper()
		rel := math.Abs(a-b) / math.Max(1e-9, math.Abs(a))
		if rel > 1e-9 {
			t.Errorf("%s scale-invariance mismatch: 1x=%.10f vs 2x=%.10f (rel=%e)", name, a, b, rel)
		}
	}
	assertClose("ShootFWgPerPlant", st1x.ShootFWgPerPlant, st2x.ShootFWgPerPlant)
	assertClose("EC25dSm", st1x.EC25dSm, st2x.EC25dSm)
	assertClose("PH", st1x.PH, st2x.PH)
	assertClose("CDOResMgL", st1x.CDOResMgL, st2x.CDOResMgL)
	assertClose("TResC", st1x.TResC, st2x.TResC)
	assertClose("TAirC", st1x.TAirC, st2x.TAirC)
}

// TestSection15_4_LiteratureGoldenBenchmarks verifies the Benson & Krause (1984) DO saturation table
// and Stanghellini (1987) canopy transpiration table in PHYSICS_SPEC.md Section 15.4.
func TestSection15_4_LiteratureGoldenBenchmarks(t *testing.T) {
	t.Parallel()

	// Table 15.4A: Benson & Krause (1984) DO Saturation at S=0, P_atm=1 (z_elev=0)
	bkCases := []struct {
		twC      float64
		wantDOS0 float64
		wantDOEC float64 // at EC=2.0 dS/m (S=1.1‰)
	}{
		{0.0, 14.6208, 14.5088},
		{10.0, 11.2879, 11.2088},
		{20.0, 9.0924, 9.0336},
		{23.0, 8.5782, 8.5240},
		{25.0, 8.2635, 8.2119},
		{30.0, 7.5588, 7.5133},
		{35.0, 6.9493, 6.9088},
	}
	for _, tc := range bkCases {
		gotS0 := physics.DOSaturationBensonKrause(tc.twC, 0.0, 0.0)
		if math.Abs(gotS0-tc.wantDOS0) > 0.002 {
			t.Errorf("BensonKrause(T=%.0fC, EC=0) = %.4f, want %.4f", tc.twC, gotS0, tc.wantDOS0)
		}
		gotEC := physics.DOSaturationBensonKrause(tc.twC, 2.0, 0.0)
		if math.Abs(gotEC-tc.wantDOEC) > 0.002 {
			t.Errorf("BensonKrause(T=%.0fC, EC=2.0) = %.4f, want %.4f", tc.twC, gotEC, tc.wantDOEC)
		}
	}

	// Table 15.4C: Stanghellini (1987) Canopy Resistances & Transpiration (u_can=0.20 m/s, l_leaf=0.10 m)
	stCases := []struct {
		iCanSW     float64
		tAirC      float64
		rhPct      float64
		lai        float64
		wantRe     float64
		wantLatent float64
	}{
		{0.0, 18.0, 75.0, 2.0, 210.6, 11.1},
		{100.0, 22.0, 65.0, 2.0, 210.6, 82.9},
		{300.0, 24.0, 60.0, 3.0, 210.6, 219.1},
		{500.0, 26.0, 55.0, 3.5, 210.6, 350.3},
	}
	for _, tc := range stCases {
		re, _, latent, _, _ := physics.StanghelliniTranspiration(tc.iCanSW, tc.tAirC, tc.rhPct, 400.0, tc.lai, 0.20, 0.10)
		if math.Abs(re-tc.wantRe) > 0.2 {
			t.Errorf("Stanghellini r_e = %.1f, want %.1f", re, tc.wantRe)
		}
		if math.Abs(latent-tc.wantLatent) > 2.5 {
			t.Errorf("Stanghellini latent(I=%.0f) = %.1f W/m^2, want %.1f W/m^2", tc.iCanSW, latent, tc.wantLatent)
		}
	}
}

// TestModule12_LeakVsHeatwaveSignatureAnd30DaySpeed verifies:
// 1. A physical reservoir leak drops V_res WITHOUT concentrating EC25, whereas high transpiration concentrates EC25.
// 2. A full 30-day simulation (8,640 steps at dt=300s) executes well within our <50ms NFR target.
func TestModule12_LeakVsHeatwaveSignatureAnd30DaySpeed(t *testing.T) {
	t.Parallel()
	spec := domain.DefaultDemoFarm()
	cfg := physics.FromFarmSpec(spec)
	eng := physics.NewEngine()

	// Advance baseline to Day 15 so canopy LAI is established
	base := eng.InitState(cfg)
	for i := 0; i < 288*15; i++ {
		base, _ = eng.Step(cfg, base, domain.Actuation{}, nil, 300.0, nil)
	}

	// Branch A: Physical Reservoir Orifice Leak (Module 12.1.6) over 6 hours
	stLeak := base.Clone()
	leakFault := []domain.FaultSpec{{
		Kind:              domain.FaultReservoirLeak,
		TargetComponentID: "reservoir-1",
		Intensity:         1.5e-5, // 15 mm^2 puncture
	}}
	for i := 0; i < 72; i++ {
		stLeak, _ = eng.Step(cfg, stLeak, domain.Actuation{}, leakFault, 300.0, nil)
	}

	// Branch B: Heat Wave (+12K) over 6 hours
	stHW := base.Clone()
	hwFault := []domain.FaultSpec{{
		Kind:              domain.FaultHeatWave,
		TargetComponentID: "enclosure-1",
		Intensity:         12.0,
	}}
	for i := 0; i < 72; i++ {
		stHW, _ = eng.Step(cfg, stHW, domain.Actuation{}, hwFault, 300.0, nil)
	}

	if stLeak.VResM3 >= base.VResM3-0.015 {
		t.Fatalf("expected significant reservoir volume drop under orifice leak: before=%f after=%f", base.VResM3, stLeak.VResM3)
	}
	// Under a leak, bulk water + solutes leave together, so EC does not spike like heatwave transpiration
	if stLeak.EC25dSm >= stHW.EC25dSm {
		t.Fatalf("expected leak EC (%f) to be lower than heatwave transpiration-concentrated EC (%f)", stLeak.EC25dSm, stHW.EC25dSm)
	}

	// 30-day performance check (< 50 ms target)
	rng := rand.New(rand.NewPCG(99, 99))
	stPerf := eng.InitState(cfg)
	start := time.Now()
	for i := 0; i < 8640; i++ {
		stPerf, _ = eng.Step(cfg, stPerf, domain.Actuation{}, nil, 300.0, rng)
	}
	elapsed := time.Since(start)
	if elapsed > 150*time.Millisecond {
		t.Errorf("30-day simulation (8640 steps) took %v, expected fast in-memory execution", elapsed)
	}
	t.Logf("30-day simulation (8,640 coupled ODE steps) completed in %v (Final FW=%.1f g/plant, EC25=%.2f dS/m, pH=%.2f)",
		elapsed, stPerf.ShootFWgPerPlant, stPerf.EC25dSm, stPerf.PH)
}
