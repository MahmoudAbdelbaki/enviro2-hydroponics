package physics

import (
	"math"

	"github.com/abdelbaky/hydro/internal/domain"
)

// Ion identifies one of the 10 dissolved ionic species in Module 3.
type Ion int

const (
	IonNO3 Ion = iota
	IonNH4
	IonP // Total orthophosphate (H2PO4- + HPO4^2-)
	IonK
	IonCa
	IonMg
	IonSO4
	IonNa
	IonCl
	IonFe // Chelated iron
	NumIons = 10
)

var IonNames = [NumIons]string{
	"NO3", "NH4", "P_tot", "K", "Ca", "Mg", "SO4", "Na", "Cl", "Fe",
}

// IonValence stores |z_i| for each species (note: P speciation is handled dynamically in EC/pH).
var IonValence = [NumIons]float64{
	1, 1, 1, 1, 2, 2, 2, 1, 1, 2,
}

// IonVec holds molar concentrations [mol/m^3 = mmol/L] or molar inventories [mol] for the 10 species.
type IonVec [NumIons]float64

// Config holds the Master Configuration Inputs (C) in strict SI units (PHYSICS_SPEC.md Section 0.1 & 0.2).
type Config struct {
	// Reservoir
	ReservoirID   string
	VRes0M3       float64
	VResMaxM3     float64
	VResDeadM3    float64
	AResM2        float64
	HResM         float64
	UResWM2K      float64
	ResPlacement  string // indoor, shaded, sun

	// Pump
	PumpID        string
	QPumpRatedM3S float64
	EtaPump0      float64

	// Aerator
	AeratorID     string
	QAirM3S       float64
	OTRStdGS      float64

	// Channels
	NCh           int
	LChM          float64
	WChM          float64
	S0            float64
	SPlM          float64
	NPlCh         int
	D0Days        float64

	// Enclosure
	EnclosureID   string
	EnclosureType string // open_air, shade_net, greenhouse, indoor_LED
	AFlM2         float64
	VEncM3        float64
	TauCov        float64
	UVentMS       float64

	// Fans
	FansID        string
	FanPlacement  string // none, exhaust, horizontal_canopy, vertical_destrat
	QFanM3S       float64

	// Derived Geometric Invariants (Section 0.2)
	NPl           int
	RhoPl         float64 // plants / m^2
	AChTotM2      float64
	WPitchM       float64
	HEncM         float64

	// Chemistry: Initial Solution, Source Water, and 4 Dosing Stocks
	InitIonsMolM3 IonVec
	InitAlkEqM3   float64
	InitDICMolM3  float64

	SrcIonsMolM3  IonVec
	SrcAlkEqM3    float64
	SrcDICMolM3   float64

	StockAIons    IonVec
	StockAAlk     float64
	StockBIons    IonVec
	StockBAlk     float64
	StockAcidIons IonVec
	StockAcidAlk  float64
	StockBaseIons IonVec
	StockBaseAlk  float64

	// Location & Date
	PhiLatRad     float64
	LambdaLonRad  float64
	ZElevM        float64
	DOY0          int

	// Sensors (Module 11)
	Sensors       []SensorConfig

	// Switch to completely disable ambient evaporation/transpiration/uptake for Section 15.1 isolated conservation test
	DisableSourcesAndSinks bool
}

type SensorConfig struct {
	ID           string
	Kind         string
	AttachedToID string
	Sigma        float64 // white noise std dev
	DriftPerSec  float64 // unit / s
	DropoutProb  float64
	TauLagSec    float64
}

// FromFarmSpec maps a validated domain.FarmSpec into strict SI physics.Config.
func FromFarmSpec(spec domain.FarmSpec) Config {
	vRes0M3 := spec.Reservoir.InitialVolumeL * 1e-3
	vResMaxM3 := spec.Reservoir.MaxVolumeL * 1e-3
	aRes := spec.Reservoir.SurfaceAreaM2
	hRes := 0.5
	if aRes > 0 {
		hRes = vRes0M3 / aRes
	}

	nCh := len(spec.Channels)
	var lCh, wCh, s0, sPl, d0 float64
	var nPlCh int
	if nCh > 0 {
		ch0 := spec.Channels[0]
		lCh = ch0.LengthM
		wCh = ch0.WidthM
		s0 = ch0.Slope
		sPl = ch0.PlantSpacingM
		nPlCh = ch0.PlantsPerChannel
		d0 = ch0.InitialPlantAgeDays
	}

	nPl := nCh * nPlCh
	aFl := spec.Enclosure.FloorAreaM2
	rhoPl := 0.0
	if aFl > 0 {
		rhoPl = float64(nPl) / aFl
	}
	aChTot := float64(nCh) * lCh * wCh
	wPitch := 0.25
	if nCh > 0 && lCh > 0 {
		wPitch = aFl / (float64(nCh) * lCh)
	}
	hEnc := 3.0
	if aFl > 0 {
		hEnc = spec.Enclosure.AirVolumeM3 / aFl
	}

	initIons, initAlk, initDIC := resolveWaterChemistry(spec.InitialSolution)
	srcIons, srcAlk, srcDIC := resolveWaterChemistry(spec.SourceWater)
	stAIons, stAAlk := resolveStockChemistry(spec.DosingStocks.StockA)
	stBIons, stBAlk := resolveStockChemistry(spec.DosingStocks.StockB)
	stAcidIons, stAcidAlk := resolveStockChemistry(spec.DosingStocks.Acid)
	stBaseIons, stBaseAlk := resolveStockChemistry(spec.DosingStocks.Base)

	sensors := make([]SensorConfig, 0, len(spec.Sensors))
	for _, s := range spec.Sensors {
		tau := 10.0
		switch s.Kind {
		case "EC":
			tau = 5.0
		case "pH":
			tau = 15.0
		case "DO":
			tau = 30.0
		case "T_w", "T_air":
			tau = 20.0
		}
		sensors = append(sensors, SensorConfig{
			ID:           s.ID,
			Kind:         s.Kind,
			AttachedToID: s.AttachedToID,
			Sigma:        s.Accuracy,
			DriftPerSec:  s.DriftPerDay / 86400.0,
			DropoutProb:  s.DropoutProb,
			TauLagSec:    tau,
		})
	}

	return Config{
		ReservoirID:   spec.Reservoir.ID,
		VRes0M3:       vRes0M3,
		VResMaxM3:     vResMaxM3,
		VResDeadM3:    0.02 * vRes0M3,
		AResM2:        aRes,
		HResM:         hRes,
		UResWM2K:      spec.Reservoir.WallConductanceWM2K,
		ResPlacement:  spec.Reservoir.Placement,
		PumpID:        spec.Pump.ID,
		QPumpRatedM3S: spec.Pump.RatedFlowLMin / 60000.0,
		EtaPump0:      spec.Pump.InitialHealth,
		AeratorID:     spec.Aerator.ID,
		QAirM3S:       spec.Aerator.AirFlowLMin / 60000.0,
		OTRStdGS:      spec.Aerator.OTRStdGH / 3600.0,
		NCh:           nCh,
		LChM:          lCh,
		WChM:          wCh,
		S0:            s0,
		SPlM:          sPl,
		NPlCh:         nPlCh,
		D0Days:        d0,
		EnclosureID:   spec.Enclosure.ID,
		EnclosureType: spec.Enclosure.Type,
		AFlM2:         aFl,
		VEncM3:        spec.Enclosure.AirVolumeM3,
		TauCov:        spec.Enclosure.CoverTransmittance,
		UVentMS:       spec.Enclosure.VentConductanceMS,
		FansID:        spec.Fans.ID,
		FanPlacement:  spec.Fans.Placement,
		QFanM3S:       spec.Fans.AirflowM3S,
		NPl:           nPl,
		RhoPl:         rhoPl,
		AChTotM2:      aChTot,
		WPitchM:       wPitch,
		HEncM:         hEnc,
		InitIonsMolM3: initIons,
		InitAlkEqM3:   initAlk,
		InitDICMolM3:  initDIC,
		SrcIonsMolM3:  srcIons,
		SrcAlkEqM3:    srcAlk,
		SrcDICMolM3:   srcDIC,
		StockAIons:    stAIons,
		StockAAlk:     stAAlk,
		StockBIons:    stBIons,
		StockBAlk:     stBAlk,
		StockAcidIons: stAcidIons,
		StockAcidAlk:  stAcidAlk,
		StockBaseIons: stBaseIons,
		StockBaseAlk:  stBaseAlk,
		PhiLatRad:     spec.Location.LatDeg * math.Pi / 180.0,
		LambdaLonRad:  spec.Location.LonDeg * math.Pi / 180.0,
		ZElevM:        spec.Location.ElevationM,
		DOY0:          spec.Location.StartDOY,
		Sensors:       sensors,
	}
}

func resolveWaterChemistry(ws domain.WaterChemistrySpec) (ions IonVec, alkEqM3, dicMolM3 float64) {
	switch ws.Profile {
	case "hoagland_lettuce_std":
		// Standard NFT lettuce nutrient solution (~1.80 dS/m EC25, pH ~6.0)
		ions = IonVec{
			IonNO3: 11.5,
			IonNH4: 1.0,
			IonP:   1.2,
			IonK:   6.0,
			IonCa:  3.2,
			IonMg:  1.0,
			IonSO4: 1.0,
			IonNa:  0.2,
			IonCl:  0.2,
			IonFe:  0.05,
		}
		alkEqM3 = 0.45
		dicMolM3 = 0.40
	case "egypt_nile_fresh":
		ions = IonVec{
			IonNO3: 0.05,
			IonNH4: 0.0,
			IonP:   0.01,
			IonK:   0.15,
			IonCa:  0.80,
			IonMg:  0.40,
			IonSO4: 0.35,
			IonNa:  0.90,
			IonCl:  0.70,
			IonFe:  0.0,
		}
		alkEqM3 = 1.60
		dicMolM3 = 1.75
	case "egypt_delta_brackish":
		ions = IonVec{
			IonNO3: 0.10,
			IonNH4: 0.0,
			IonP:   0.0,
			IonK:   0.20,
			IonCa:  1.50,
			IonMg:  1.00,
			IonSO4: 1.20,
			IonNa:  8.50,
			IonCl:  8.50,
			IonFe:  0.0,
		}
		alkEqM3 = 2.40
		dicMolM3 = 2.50
	case "ro_pure":
		ions = IonVec{}
		alkEqM3 = 0.01
		dicMolM3 = 0.015
	default:
		ions = IonVec{}
		alkEqM3 = 0.20
		dicMolM3 = 0.20
	}

	applyIonOverrides(&ions, ws.IonsMmolL)
	if ws.AlkalinityMeqL != nil {
		alkEqM3 = *ws.AlkalinityMeqL
		dicMolM3 = math.Max(0.01, alkEqM3)
	}
	return ions, alkEqM3, dicMolM3
}

func resolveStockChemistry(st domain.StockTankSpec) (ions IonVec, netAlkEqM3 float64) {
	switch st.Profile {
	case "standard_part_a":
		// Calcium nitrate + potassium nitrate + chelated iron (100x concentrate)
		ions = IonVec{
			IonNO3: 750.0,
			IonNH4: 50.0,
			IonK:   250.0,
			IonCa:  300.0,
			IonFe:  5.0,
		}
		netAlkEqM3 = 0.0
	case "standard_part_b":
		// Monopotassium phosphate + magnesium sulfate + potassium sulfate (100x concentrate)
		ions = IonVec{
			IonNO3: 350.0,
			IonP:   120.0,
			IonK:   350.0,
			IonMg:  100.0,
			IonSO4: 100.0,
		}
		netAlkEqM3 = 0.0
	case "nitric_acid_0_5M":
		ions = IonVec{
			IonNO3: 500.0,
		}
		netAlkEqM3 = -500.0
	case "potassium_hydroxide_0_5M":
		ions = IonVec{
			IonK: 500.0,
		}
		netAlkEqM3 = 500.0
	}

	applyIonOverrides(&ions, st.IonsMmolL)
	if st.NetAlkalinityMeqL != nil {
		netAlkEqM3 = *st.NetAlkalinityMeqL
	}
	return ions, netAlkEqM3
}

func applyIonOverrides(dst *IonVec, ov *domain.IonOverrides) {
	if ov == nil {
		return
	}
	if ov.NO3 != nil {
		dst[IonNO3] = *ov.NO3
	}
	if ov.NH4 != nil {
		dst[IonNH4] = *ov.NH4
	}
	if ov.PTot != nil {
		dst[IonP] = *ov.PTot
	}
	if ov.K != nil {
		dst[IonK] = *ov.K
	}
	if ov.Ca != nil {
		dst[IonCa] = *ov.Ca
	}
	if ov.Mg != nil {
		dst[IonMg] = *ov.Mg
	}
	if ov.SO4 != nil {
		dst[IonSO4] = *ov.SO4
	}
	if ov.Na != nil {
		dst[IonNa] = *ov.Na
	}
	if ov.Cl != nil {
		dst[IonCl] = *ov.Cl
	}
	if ov.Fe != nil {
		dst[IonFe] = *ov.Fe
	}
}
