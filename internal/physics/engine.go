package physics

import (
	"math"
	"math/rand/v2"

	"github.com/abdelbaky/hydro/internal/domain"
)

const MaxSensors = 32

type State struct {
	SimTimeSec float64
	TickIndex  int64

	// Module 1: Enclosure Climate
	TAirC  float64
	ChiVap float64
	ChiCO2 float64
	RHPct  float64
	CO2PPM float64

	// Module 2 & 7: Reservoir & Channel Hydraulics
	VResM3           float64
	VChTotM3         float64
	FilmDepthM       float64
	ResidenceTimeSec float64

	// Module 3 & 4: Conserved Molar Inventories & Concentrations
	MolesMol  IonVec
	IonsMolM3 IonVec
	AlkMol    float64
	AlkEqM3   float64
	DICMol    float64
	DICMolM3  float64
	PH        float64
	EC25dSm   float64
	ECRawdSm  float64

	// Module 5: Thermal State
	TResC   float64
	TChC    float64
	TChOutC float64

	// Module 6: Dissolved Oxygen
	CDOResMgL   float64
	CDOChOutMgL float64

	// Module 8-10: Two-State Crop Biomass & Canopy Proxies
	XnsdwKgM2        float64
	XsdwKgM2         float64
	XdKgM2           float64
	LAI              float64
	LAIEff           float64
	CanopyCoverPct   float64
	ShootDWgPerPlant float64
	RootDWgPerPlant  float64
	ShootFWgPerPlant float64
	StressFactor     float64

	// Persistent actuator throttles
	PumpThrottle    float64
	AeratorThrottle float64
	FanThrottle     float64

	// Module 11: Sensor Observer States
	SensorLag   [MaxSensors]float64
	SensorDrift [MaxSensors]float64
}

func (s State) Clone() State {
	return s
}

// ToGroundTruth converts internal physics SI state into the operator GroundTruthState DTO.
func (s State) ToGroundTruth(faults []domain.FaultSpec) domain.GroundTruthState {
	ions := make(map[string]float64, NumIons)
	for i := 0; i < NumIons; i++ {
		ions[IonNames[i]] = s.IonsMolM3[i]
	}
	active := make([]domain.FaultSpec, 0, len(faults))
	for _, f := range faults {
		if !f.Clear {
			active = append(active, f)
		}
	}
	return domain.GroundTruthState{
		SimTimeSec:       s.SimTimeSec,
		TickIndex:        s.TickIndex,
		VResL:            s.VResM3 * 1000.0,
		VChTotL:          s.VChTotM3 * 1000.0,
		TAirC:            s.TAirC,
		RHPct:            s.RHPct,
		CO2PPM:           s.CO2PPM,
		TResC:            s.TResC,
		TChOutC:          s.TChOutC,
		PH:               s.PH,
		EC25dSm:          s.EC25dSm,
		ECRawdSm:         s.ECRawdSm,
		AlkalinityMeqL:   s.AlkEqM3,
		DICMmolL:         s.DICMolM3,
		CDOResMgL:        s.CDOResMgL,
		CDOChOutMgL:      s.CDOChOutMgL,
		FilmDepthMM:      s.FilmDepthM * 1000.0,
		ResidenceTimeSec: s.ResidenceTimeSec,
		LAI:              s.LAI,
		CanopyCoverPct:   s.CanopyCoverPct,
		ShootDWgPerPlant: s.ShootDWgPerPlant,
		RootDWgPerPlant:  s.RootDWgPerPlant,
		ShootFWgPerPlant: s.ShootFWgPerPlant,
		StressFactor:     s.StressFactor,
		IonsMmolL:        ions,
		ActiveFaults:     active,
	}
}

// ObserveInitial returns initial t=0 sensor readings for a newly initialized simulation.
func (e *Engine) ObserveInitial(cfg Config, st State) []domain.SensorReading {
	readings := make([]domain.SensorReading, len(cfg.Sensors))
	for idx, sen := range cfg.Sensors {
		val := trueSensorQuantity(st, sen.Kind, 0)
		if idx < MaxSensors {
			val = st.SensorLag[idx]
		}
		vCopy := val
		readings[idx] = domain.SensorReading{
			TickIndex:   st.TickIndex,
			SimTimeSec:  st.SimTimeSec,
			SensorID:    sen.ID,
			ComponentID: sen.AttachedToID,
			Kind:        sen.Kind,
			Value:       &vCopy,
			Unit:        sensorUnit(sen.Kind),
		}
	}
	return readings
}

type Engine struct{}

func NewEngine() *Engine {
	return &Engine{}
}

func (e *Engine) InitState(cfg Config) State {
	const wd0KgPerPlant = 1.2e-4 // 0.12 g DM at transplant
	const r0PerDay = 0.18
	var xd0 float64
	if cfg.NPl > 0 && cfg.RhoPl > 0 {
		wdPlant := wd0KgPerPlant * math.Exp(r0PerDay*cfg.D0Days)
		xd0 = cfg.RhoPl * wdPlant
	}
	xnsdw0 := 0.15 * xd0
	xsdw0 := 0.85 * xd0

	qPump0 := cfg.EtaPump0 * cfg.QPumpRatedM3S
	hCh0, _, vChTot0, tauCh0 := computeHydraulics(cfg, qPump0, xd0)
	vTot0 := cfg.VRes0M3 + vChTot0

	var moles0 IonVec
	for i := 0; i < NumIons; i++ {
		moles0[i] = vTot0 * cfg.InitIonsMolM3[i]
	}
	alkMol0 := vTot0 * cfg.InitAlkEqM3
	dicMol0 := vTot0 * cfg.InitDICMolM3

	iStr0 := IonicStrengthMolL(cfg.InitIonsMolM3)
	ph0, hMol0 := SolveEquilibriumPH(cfg.InitAlkEqM3, cfg.InitDICMolM3, cfg.InitIonsMolM3[IonP], cfg.InitIonsMolM3[IonNH4], iStr0)
	tRes0 := 21.0
	ec25_0, ecRaw0 := ComputeEC(cfg.InitIonsMolM3, cfg.InitDICMolM3, ph0, hMol0, tRes0)
	cDOSat0 := DOSaturationBensonKrause(tRes0, ec25_0, cfg.ZElevM)

	tAir0 := 22.0
	rh0 := 65.0
	_, _, chiStar0 := SaturationVaporRelation(tAir0)
	chiVap0 := (rh0 / 100.0) * chiStar0
	co2PPM0 := 410.0
	chiCO2_0 := co2PPMToKgM3(co2PPM0, tAir0, cfg.ZElevM)

	lai0, laiEff0, cc0, shDW, rtDW, shFW := computeCanopyAndYield(cfg, xnsdw0+xsdw0, ec25_0)

	st := State{
		SimTimeSec:       0,
		TickIndex:        0,
		TAirC:            tAir0,
		ChiVap:           chiVap0,
		ChiCO2:           chiCO2_0,
		RHPct:            rh0,
		CO2PPM:           co2PPM0,
		VResM3:           cfg.VRes0M3,
		VChTotM3:         vChTot0,
		FilmDepthM:       hCh0,
		ResidenceTimeSec: tauCh0,
		MolesMol:         moles0,
		IonsMolM3:        cfg.InitIonsMolM3,
		AlkMol:           alkMol0,
		AlkEqM3:          cfg.InitAlkEqM3,
		DICMol:           dicMol0,
		DICMolM3:         cfg.InitDICMolM3,
		PH:               ph0,
		EC25dSm:          ec25_0,
		ECRawdSm:         ecRaw0,
		TResC:            tRes0,
		TChC:             tRes0,
		TChOutC:          tRes0,
		CDOResMgL:        0.95 * cDOSat0,
		CDOChOutMgL:      0.92 * cDOSat0,
		XnsdwKgM2:        xnsdw0,
		XsdwKgM2:         xsdw0,
		XdKgM2:           xd0,
		LAI:              lai0,
		LAIEff:           laiEff0,
		CanopyCoverPct:   cc0,
		ShootDWgPerPlant: shDW,
		RootDWgPerPlant:  rtDW,
		ShootFWgPerPlant: shFW,
		StressFactor:     1.0,
		PumpThrottle:     1.0,
		AeratorThrottle:  1.0,
		FanThrottle:      1.0,
	}

	for idx, sen := range cfg.Sensors {
		if idx >= MaxSensors {
			break
		}
		st.SensorLag[idx] = trueSensorQuantity(st, sen.Kind, 0)
		st.SensorDrift[idx] = 0.0
	}
	return st
}

func (e *Engine) Step(
	cfg Config,
	prev State,
	act domain.Actuation,
	faults []domain.FaultSpec,
	dtSec float64,
	rng *rand.Rand,
) (State, []domain.SensorReading) {
	st := prev
	if dtSec <= 0 {
		dtSec = 60.0
	}

	if act.PumpThrottle != nil {
		st.PumpThrottle = clamp(*act.PumpThrottle, 0.0, 1.0)
	}
	if act.AeratorThrottle != nil {
		st.AeratorThrottle = clamp(*act.AeratorThrottle, 0.0, 1.0)
	}
	if act.FanThrottle != nil {
		st.FanThrottle = clamp(*act.FanThrottle, 0.0, 1.0)
	}

	var fPump, fAer, dTHW, fHWRad, aLeakM2, dImb float64
	var hasProbeFault bool
	for i := range faults {
		f := &faults[i]
		if f.Clear || st.SimTimeSec+dtSec < f.TriggerAtSimSec {
			continue
		}
		switch f.Kind {
		case domain.FaultPumpDegradation:
			fPump = clamp(f.Intensity, 0.0, 1.0)
		case domain.FaultAerationLoss:
			fAer = clamp(f.Intensity, 0.0, 1.0)
		case domain.FaultHeatWave:
			dTHW = f.Intensity
			fHWRad = 0.15
		case domain.FaultProbeDrift:
			hasProbeFault = true
		case domain.FaultNutrientImbalance:
			dImb = f.Intensity
		case domain.FaultReservoirLeak:
			aLeakM2 = math.Max(0, f.Intensity)
		}
	}

	qSrc := math.Max(0, act.RefillWaterM3) / dtSec
	qDoseA := math.Max(0, act.DoseStockAM3) * (1.0 + dImb) / dtSec
	qDoseB := math.Max(0, act.DoseStockBM3) / dtSec
	qDoseAcid := math.Max(0, act.DoseAcidM3) / dtSec
	qDoseBase := math.Max(0, act.DoseBaseM3) / dtSec

	tNow := st.SimTimeSec

	// --- Module 1: Outdoor & Enclosure Climate ---
	tOutC, iOutSW, rhOutPct := outdoorWeather(cfg, tNow, dTHW, fHWRad)
	var iCanSW, cPar float64
	switch cfg.EnclosureType {
	case "open_air":
		iCanSW = iOutSW
		cPar = 0.50
	case "indoor_LED":
		hourOfDay := math.Mod(tNow/3600.0, 24.0)
		tOutC = 22.4 + 0.8*math.Sin((2.0*math.Pi/24.0)*(hourOfDay-9.0)) + dTHW
		if hourOfDay >= 6.0 && hourOfDay <= 22.0 {
			iCanSW = 180.0
		}
		cPar = 0.85
	default:
		iCanSW = cfg.TauCov * iOutSW
		cPar = 0.50
	}
	if cfg.DisableSourcesAndSinks {
		iOutSW = 0
		iCanSW = 0
	}
	iPAR := cPar * iCanSW

	qFanEff := st.FanThrottle * cfg.QFanM3S
	phiExhaust := 0.0
	if cfg.FanPlacement == "exhaust" && cfg.AFlM2 > 0 {
		phiExhaust = qFanEff / cfg.AFlM2
	}
	phiLeak := 7.5e-5
	if cfg.EnclosureType == "open_air" || cfg.EnclosureType == "shade_net" {
		phiLeak = 0.25
	}
	phiVent := cfg.UVentMS + phiExhaust + phiLeak

	psiFan := 0.0
	switch cfg.FanPlacement {
	case "exhaust":
		psiFan = 0.50
	case "horizontal_canopy":
		psiFan = 2.00
	case "vertical_destrat":
		psiFan = 1.00
	}
	aspectRatio := 1.0
	if cfg.HEncM > 0 && cfg.LChM > 0 {
		aspectRatio = cfg.LChM / cfg.HEncM
	}
	qFanPerArea := 0.0
	if cfg.AFlM2 > 0 {
		qFanPerArea = qFanEff / cfg.AFlM2
	}
	uCan := 0.05 + (cfg.UVentMS+psiFan*qFanPerArea)*aspectRatio

	// --- Module 7: Channel Hydraulics ---
	etaPumpEff := cfg.EtaPump0 * st.PumpThrottle * (1.0 - fPump)
	if st.VResM3 <= cfg.VResDeadM3 {
		etaPumpEff = 0.0
	}
	qPump := etaPumpEff * cfg.QPumpRatedM3S
	hCh, vCh, vChTotNew, tauCh := computeHydraulics(cfg, qPump, st.XdKgM2)
	dvChDt := (vChTotNew - st.VChTotM3) / dtSec
	st.FilmDepthM = hCh
	st.VChTotM3 = vChTotNew
	st.ResidenceTimeSec = tauCh

	// --- Module 8: Canopy Transpiration ---
	re, ri, _, eCanKgM2S, hCanWM2 := StanghelliniTranspiration(
		iCanSW, st.TAirC, st.RHPct, st.CO2PPM, st.LAIEff, uCan, 0.10,
	)
	if cfg.DisableSourcesAndSinks || cfg.NPl == 0 {
		eCanKgM2S = 0
		hCanWM2 = 0
	}

	// --- Module 2: Free-Surface Evaporation & Reservoir Leak ---
	const rhoW = 998.2
	_, _, chiStarRes := SaturationVaporRelation(st.TResC)
	_, _, chiStarCh := SaturationVaporRelation(st.TChC)
	_, _, chiStarOut := SaturationVaporRelation(tOutC)
	chiVapOut := (rhOutPct / 100.0) * chiStarOut

	qEvapRes := 0.0
	qEvapCh := 0.0
	if !cfg.DisableSourcesAndSinks {
		const cEvapRes = 2.0e-4
		const cLeakEvap = 5.5e-7
		qEvapRes = (cEvapRes * cfg.AResM2 / rhoW) * math.Max(0, chiStarRes-st.ChiVap)
		qEvapCh = (cLeakEvap * cfg.AChTotM2 * math.Exp(-0.70*st.LAIEff) / rhoW) * math.Max(0, chiStarCh-st.ChiVap)
	}

	qLeak := 0.0
	if !cfg.DisableSourcesAndSinks && aLeakM2 > 0 && cfg.AResM2 > 0 && st.VResM3 > 0 {
		hHead := st.VResM3 / cfg.AResM2
		qLeak = 0.61 * aLeakM2 * math.Sqrt(2.0*9.80665*hHead)
	}

	// --- Module 10: Canopy Photosynthesis, Respiration & Stress ---
	phiPhot, phiResp, rGr := computeCropFluxes(cfg, st, iPAR, re, ri)
	if cfg.DisableSourcesAndSinks || cfg.NPl == 0 {
		phiPhot = 0
		phiResp = 0
		rGr = 0
	}

	const rhoA = 1.20
	const cpA = 1010.0
	const uChTop = 6.0
	const uCov = 4.0
	hEncEff := math.Max(0.5, cfg.HEncM)
	qRadAir := (1.0 - 0.80*(1.0-math.Exp(-0.70*st.LAIEff))) * iCanSW
	hChToAir := 0.0
	if cfg.AFlM2 > 0 {
		hChToAir = (cfg.AChTotM2 / cfg.AFlM2) * uChTop * (st.TChC - st.TAirC)
	}
	// Greenhouse thermostatic roof/evaporative ventilation conductance keeps daytime T_air within physiological range
	ventSensCoeff := rhoA*cpA*(phiVent+0.08) + uCov
	kLossAir := ventSensCoeff / (rhoA * cpA * hEncEff)
	tAirEq := tOutC + (0.25*qRadAir+hCanWM2+hChToAir)/math.Max(1.0, ventSensCoeff)
	alphaAir := 1.0 - math.Exp(-dtSec*kLossAir)
	st.TAirC = clamp(st.TAirC+alphaAir*(tAirEq-st.TAirC), 5.0, 45.0)

	eEvapFree := 0.0
	if cfg.AFlM2 > 0 {
		eEvapFree = rhoW * (qEvapRes + qEvapCh) / cfg.AFlM2
	}
	alphaVent := 1.0 - math.Exp(-dtSec*(phiVent/hEncEff))
	chiVapEq := chiVapOut + (eCanKgM2S+eEvapFree)/math.Max(1e-5, phiVent)
	_, _, chiStarAirNew := SaturationVaporRelation(st.TAirC)
	st.ChiVap = clamp(st.ChiVap+alphaVent*(chiVapEq-st.ChiVap), 0.05*chiStarAirNew, chiStarAirNew)
	st.RHPct = clamp(100.0*(st.ChiVap/chiStarAirNew), 10.0, 100.0)

	chiCO2Out := co2PPMToKgM3(410.0, tOutC, cfg.ZElevM)
	chiCO2Eq := chiCO2Out - (phiPhot-(44.0/30.0)*phiResp)/math.Max(1e-5, phiVent)
	st.ChiCO2 = math.Max(co2PPMToKgM3(180.0, st.TAirC, cfg.ZElevM), st.ChiCO2+alphaVent*(chiCO2Eq-st.ChiCO2))
	st.CO2PPM = clamp(kgM3ToCO2PPM(st.ChiCO2, st.TAirC, cfg.ZElevM), 180.0, 2000.0)

	// --- Module 9: Root Water & Ion Uptake ---
	phiDOWat := 0.70 + 0.30*(st.CDOChOutMgL/(1.50+st.CDOChOutMgL))
	qWatTot := (cfg.AFlM2 * eCanKgM2S / rhoW) * phiDOWat
	if cfg.DisableSourcesAndSinks || cfg.NPl == 0 {
		qWatTot = 0
	}

	// Update Reservoir & Total Loop Water Volume (Module 2 Eq. 2.1)
	qDoseTot := qDoseA + qDoseB + qDoseAcid + qDoseBase
	dVResDt := qSrc + qDoseTot - qWatTot - qEvapRes - qEvapCh - qLeak - dvChDt
	st.VResM3 = math.Max(cfg.VResDeadM3*0.5, st.VResM3+dtSec*dVResDt)
	vTot := math.Max(1e-6, st.VResM3+st.VChTotM3)

	// Update Crop Dry Matter (Module 10 Eq. 10.1 Two-State Van Henten 1994)
	const cAlpha = 0.68
	const cBeta = 0.80
	var dXdDt float64
	if cfg.NPl > 0 && !cfg.DisableSourcesAndSinks {
		assim := cAlpha * st.StressFactor * phiPhot
		dXnsdw := assim - rGr*st.XsdwKgM2 - phiResp - ((1.0-cBeta)/cBeta)*rGr*st.XsdwKgM2
		dXsdw := rGr * st.XsdwKgM2
		st.XnsdwKgM2 = math.Max(1e-7, st.XnsdwKgM2+dtSec*dXnsdw)
		st.XsdwKgM2 = math.Max(1e-6, st.XsdwKgM2+dtSec*dXsdw)
		prevXd := st.XdKgM2
		st.XdKgM2 = st.XnsdwKgM2 + st.XsdwKgM2
		dXdDt = math.Max(0, (st.XdKgM2-prevXd)/dtSec)
	}

	// Compute Per-Plant Ion Uptake J_up,i (Module 9 Eqs. 9.2 & 9.3)
	var nPlJUp IonVec
	if cfg.NPl > 0 && !cfg.DisableSourcesAndSinks {
		nPlJUp = computeTotalIonUptake(cfg, st, dXdDt, qWatTot)
	}

	// Module 3: Species Molar Mass Balance (Eq. 3.1 & 3.2)
	for i := 0; i < NumIons; i++ {
		ci := st.IonsMolM3[i]
		rPrecip := computePrecipitationRate(Ion(i), st.IonsMolM3, st.PH)
		if cfg.DisableSourcesAndSinks {
			rPrecip = 0
		}
		doseIn := qDoseA*cfg.StockAIons[i] +
			qDoseB*cfg.StockBIons[i] +
			qDoseAcid*cfg.StockAcidIons[i] +
			qDoseBase*cfg.StockBaseIons[i]
		dMiDt := qSrc*cfg.SrcIonsMolM3[i] + doseIn - nPlJUp[i] - rPrecip*vTot - qLeak*ci
		st.MolesMol[i] = math.Max(0, st.MolesMol[i]+dtSec*dMiDt)
		st.IonsMolM3[i] = st.MolesMol[i] / vTot
	}

	// --- Module 6: Dissolved Oxygen & Root Respiration ---
	cDOSatRes := DOSaturationBensonKrause(st.TResC, st.EC25dSm, cfg.ZElevM)
	cDOSatCh := DOSaturationBensonKrause(st.TChC, st.EC25dSm, cfg.ZElevM)

	const cTauRoot = 0.12
	const rO2Ref = 7.8e-4 // [g O2 / (kg root DM * s)] at 23C
	var totRootO2GS float64
	if cfg.NPl > 0 && !cfg.DisableSourcesAndSinks {
		totRootDMKg := cfg.AFlM2 * cTauRoot * st.XdKgM2
		q10Factor := math.Pow(2.0, (st.TChC-23.0)/10.0)
		mmDO := st.CDOChOutMgL / (1.50 + st.CDOChOutMgL)
		totRootO2GS = rO2Ref * totRootDMKg * q10Factor * mmDO
	}

	// Covered NFT gully film reaeration is restricted by root mat & gully lid
	const kvCh20 = 1.5e-6
	kvCh := kvCh20 * math.Pow(1.024, st.TChC-20.0) * math.Sqrt(math.Max(0.05, vCh/0.14)) * math.Pow(math.Max(0.2, hCh/0.0018), -0.5)
	var klaAer float64
	if !cfg.DisableSourcesAndSinks {
		otrEff := st.AeratorThrottle * (1.0 - fAer) * cfg.OTRStdGS
		qAirEff := st.AeratorThrottle * (1.0 - fAer) * cfg.QAirM3S
		cSat20 := DOSaturationBensonKrause(20.0, st.EC25dSm, cfg.ZElevM)
		if otrEff > 0 {
			klaAer = math.Pow(1.024, st.TResC-20.0) * (otrEff / (st.VResM3 * cSat20))
		} else if qAirEff > 0 {
			klaAer = math.Pow(1.024, st.TResC-20.0) * ((0.015 * cfg.HResM * 280.0 * qAirEff) / (st.VResM3 * cSat20))
		}
	}
	kvRes := 1.0e-6
	if cfg.DisableSourcesAndSinks {
		kvRes = 0
	}

	kReaerTot := klaAer*st.VResM3 + kvRes*cfg.AResM2 + kvCh*cfg.AChTotM2
	if kReaerTot > 0 {
		cDOEqLoop := math.Max(0.20, cDOSatRes-totRootO2GS/kReaerTot)
		alphaDO := 1.0 - math.Exp(-dtSec*(kReaerTot/vTot))
		st.CDOResMgL = clamp(st.CDOResMgL+alphaDO*(cDOEqLoop-st.CDOResMgL), 0.15, 20.0)
	}
	if qPump > 1e-9 && cfg.AChTotM2 > 0 {
		singlePassDrop := totRootO2GS / (qPump + kvCh*cfg.AChTotM2)
		st.CDOChOutMgL = clamp(st.CDOResMgL-singlePassDrop, 0.10, 20.0)
	} else {
		vPuddle := math.Max(1e-6, cfg.AChTotM2*hCh)
		dDOStall := (cfg.AChTotM2*kvCh*(cDOSatCh-st.CDOChOutMgL) - totRootO2GS) / vPuddle
		st.CDOChOutMgL = clamp(st.CDOChOutMgL+dtSec*dDOStall, 0.10, 20.0)
	}
	if cfg.NPl == 0 && !cfg.DisableSourcesAndSinks {
		st.CDOChOutMgL = st.CDOResMgL
	}

	// --- Module 4: Alkalinity, DIC & Equilibrium pH ---
	const gammaOHNO3 = 0.22
	const gammaHNH4 = 1.15
	alkDose := qDoseA*cfg.StockAAlk + qDoseB*cfg.StockBAlk + qDoseAcid*cfg.StockAcidAlk + qDoseBase*cfg.StockBaseAlk
	rootAlkFlux := gammaOHNO3*nPlJUp[IonNO3] - gammaHNH4*nPlJUp[IonNH4]
	dAlkMolDt := qSrc*cfg.SrcAlkEqM3 + alkDose + rootAlkFlux - qLeak*st.AlkEqM3
	st.AlkMol += dtSec * dAlkMolDt
	st.AlkEqM3 = st.AlkMol / vTot

	iStr := IonicStrengthMolL(st.IonsMolM3)
	phNew, hMolNew := SolveEquilibriumPH(st.AlkEqM3, st.DICMolM3, st.IonsMolM3[IonP], st.IonsMolM3[IonNH4], iStr)

	h2co3Star := st.DICMolM3 * (hMolNew * hMolNew) / (hMolNew*hMolNew + ka1C*hMolNew + ka1C*ka2C)
	khCO2 := 33.8 * math.Exp(2400.0*(1.0/(st.TResC+273.15)-1.0/298.15))
	pCO2Atm := st.CO2PPM * 1e-6
	kGasCO2 := 0.89 * (klaAer*st.VResM3 + kvCh*cfg.AChTotM2)
	if cfg.DisableSourcesAndSinks {
		kGasCO2 = 0
	}
	rootCO2MolS := totRootO2GS / 32.0
	dDICMolDt := qSrc*cfg.SrcDICMolM3 + rootCO2MolS - kGasCO2*(h2co3Star-khCO2*pCO2Atm) - qLeak*st.DICMolM3
	st.DICMol = math.Max(0.15*vTot, st.DICMol+dtSec*dDICMolDt)
	st.DICMolM3 = st.DICMol / vTot

	ec25New, ecRawNew := ComputeEC(st.IonsMolM3, st.DICMolM3, phNew, hMolNew, st.TResC)
	st.PH = phNew
	st.EC25dSm = ec25New
	st.ECRawdSm = ecRawNew

	// --- Module 5: Reservoir & Channel Water Heat Balance (Eqs. 5.1 - 5.3) ---
	if !cfg.DisableSourcesAndSinks {
		const cpW = 4184.0
		const lambdaV = 2.45e6
		const alphaChSol = 0.15
		tEqCh := st.TAirC + (alphaChSol*math.Exp(-0.70*st.LAIEff)*iCanSW)/uChTop
		if qPump > 1e-9 && cfg.AChTotM2 > 0 {
			ntuHeat := (uChTop * cfg.AChTotM2) / (rhoW * cpW * qPump)
			st.TChOutC = tEqCh + (st.TResC-tEqCh)*math.Exp(-ntuHeat)
			st.TChC = 0.5 * (st.TResC + st.TChOutC)
		} else {
			st.TChOutC = st.TChC + (tEqCh-st.TChC)*math.Min(1.0, dtSec/600.0)
			st.TChC = st.TChOutC
		}

		tAmbRes := st.TAirC
		qRadRes := 0.0
		if cfg.ResPlacement == "shaded" {
			tAmbRes = tOutC
			qRadRes = 0.08 * cfg.AResM2 * iOutSW
		} else if cfg.ResPlacement == "sun" {
			tAmbRes = tOutC
			qRadRes = 0.65 * cfg.AResM2 * iOutSW
		}
		hRatio := 1.0
		if cfg.HResM > 0 && cfg.AResM2 > 0 {
			hRatio = (st.VResM3 / cfg.AResM2) / cfg.HResM
		}
		aWallEff := cfg.AResM2 * (1.0 + 2.0*hRatio)
		qChOut := math.Max(0, qPump-qWatTot-qEvapCh)
		qHeatCond := cfg.UResWM2K * aWallEff * (tAmbRes - st.TResC)
		dTResDt := (rhoW*cpW*qChOut*(st.TChOutC-st.TResC) +
			rhoW*cpW*qSrc*(20.0-st.TResC) +
			qHeatCond + qRadRes - lambdaV*rhoW*qEvapRes) / (rhoW * cpW * st.VResM3)
		st.TResC = clamp(st.TResC+dtSec*dTResDt, 4.0, 42.0)
	}

	st.StressFactor = computeRootZoneStress(st)
	st.LAI, st.LAIEff, st.CanopyCoverPct, st.ShootDWgPerPlant, st.RootDWgPerPlant, st.ShootFWgPerPlant =
		computeCanopyAndYield(cfg, st.XdKgM2, st.EC25dSm)

	st.SimTimeSec += dtSec
	st.TickIndex++

	// --- Module 11: Sensors as Noisy Observers (Eq. 11.1) ---
	var readings []domain.SensorReading
	if len(cfg.Sensors) > 0 {
		readings = make([]domain.SensorReading, len(cfg.Sensors))
		for idx, sen := range cfg.Sensors {
			xTrue := trueSensorQuantity(st, sen.Kind, 0)
			zNew := xTrue
			bNew := 0.0
			if idx < MaxSensors {
				prevLag := st.SensorLag[idx]
				alphaLag := 1.0
				if sen.TauLagSec > 0 {
					alphaLag = 1.0 - math.Exp(-dtSec/sen.TauLagSec)
				}
				zNew = prevLag + alphaLag*(xTrue-prevLag)
				st.SensorLag[idx] = zNew

				var extraDrift float64
				if hasProbeFault {
					for i := range faults {
						if !faults[i].Clear && faults[i].Kind == domain.FaultProbeDrift && faults[i].TargetComponentID == sen.ID {
							extraDrift = faults[i].Intensity
						}
					}
				}
				bNew = st.SensorDrift[idx] + (sen.DriftPerSec+extraDrift)*dtSec
				st.SensorDrift[idx] = bNew
			}

			var valPtr *float64
			if sen.DropoutProb > 0 && rng != nil && rng.Float64() < sen.DropoutProb {
				valPtr = nil
			} else {
				noise := 0.0
				if sen.Sigma > 0 && rng != nil {
					noise = rng.NormFloat64() * sen.Sigma
				}
				y := zNew + bNew + noise
				valPtr = &y
			}

			readings[idx] = domain.SensorReading{
				TickIndex:   st.TickIndex,
				SimTimeSec:  st.SimTimeSec,
				SensorID:    sen.ID,
				ComponentID: sen.AttachedToID,
				Kind:        sen.Kind,
				Value:       valPtr,
				Unit:        sensorUnit(sen.Kind),
			}
		}
	}

	return st, readings
}

func computeHydraulics(cfg Config, qPumpM3S, xdKgM2 float64) (hChM, vChMS, vChTotM3, tauChSec float64) {
	const (
		nPVC        = 0.010
		cRootDrag   = 12.0
		rhoRtBulk   = 55.0
		hResPuddleM = 5.0e-4
		cTauRoot    = 0.12
	)
	if cfg.NCh <= 0 || cfg.WChM <= 0 || cfg.S0 <= 0 {
		return hResPuddleM, 0, 0, 0
	}
	var xRtPlantKg float64
	if cfg.NPl > 0 {
		xRtPlantKg = (cfg.AFlM2 / float64(cfg.NPl)) * cTauRoot * xdKgM2
	}
	nChEff := nPVC * (1.0 + cRootDrag*(xRtPlantKg/(math.Max(1e-4, cfg.WChM*cfg.SPlM)*rhoRtBulk)))
	qCh := math.Max(0, qPumpM3S) / float64(cfg.NCh)
	if qCh <= 1e-12 {
		hChM = hResPuddleM
		vChTotM3 = cfg.AChTotM2 * hChM
		return hChM, 0, vChTotM3, 0
	}
	hChM = hResPuddleM + math.Pow((nChEff*qCh)/(cfg.WChM*math.Sqrt(cfg.S0)), 0.6)
	vChMS = qCh / (cfg.WChM * hChM)
	vChTotM3 = cfg.AChTotM2 * hChM
	tauChSec = cfg.LChM / math.Max(1e-6, vChMS)
	return hChM, vChMS, vChTotM3, tauChSec
}

func computeCropFluxes(cfg Config, st State, iPAR, re, ri float64) (phiPhot, phiResp, rGr float64) {
	gCar := math.Max(1e-6, -1.32e-5*st.TAirC*st.TAirC+5.94e-4*st.TAirC-2.64e-3)
	if st.TAirC <= 5.0 || st.TAirC >= 40.0 {
		gCar = 0
	}
	var gCO2 float64
	if gCar > 0 {
		// Use Van Henten (1994) Table 3.1 canopy CO2 conductances coupled with carboxylation
		gCO2 = 1.0 / (1.0/0.007 + 1.0/0.004 + 1.0/gCar)
	}

	gammaComp := 7.32e-5 * math.Pow(2.0, (st.TAirC-20.0)/10.0)
	if iPAR > 0 && st.LAIEff > 0 && st.ChiCO2 > gammaComp && gCO2 > 0 {
		eps := 17.0e-9 * (st.ChiCO2 - gammaComp) / (st.ChiCO2 + 2.0*gammaComp)
		num := eps * iPAR * gCO2 * (st.ChiCO2 - gammaComp)
		den := eps*iPAR + gCO2*(st.ChiCO2-gammaComp)
		phiPhotMax := num / den
		phiPhot = phiPhotMax * (1.0 - math.Exp(-0.90*st.LAIEff))
	}

	const cTau = 0.12
	const cRespS = 3.47e-7
	const cRespR = 1.16e-7
	phiResp = st.XdKgM2 * (cRespS*(1.0-cTau)*math.Pow(2.0, (st.TAirC-25.0)/10.0) +
		cRespR*cTau*math.Pow(2.0, (st.TChC-25.0)/10.0))

	const cRGrMax = 9.5e-6
	if st.XdKgM2 > 0 {
		bufSat := st.XnsdwKgM2 / (0.04*st.XsdwKgM2 + st.XnsdwKgM2)
		rGr = cRGrMax * bufSat * math.Pow(1.6, (st.TAirC-20.0)/10.0) * st.StressFactor
	}
	return phiPhot, phiResp, rGr
}

func computeTotalIonUptake(cfg Config, st State, dXdDtKgM2S, qWatTotM3S float64) IonVec {
	var tot IonVec
	const (
		cUMM  = 0.70
		nuNDM = 3.20 // [mol N / kg DM]
		nuPDM = 0.26 // [mol P / kg DM]
		nuKDM = 1.50 // [mol K / kg DM]
	)
	phiDO := math.Max(0.0, st.CDOChOutMgL-1.50) / (1.50 + math.Max(0.0, st.CDOChOutMgL-1.50))
	phiPH := math.Exp(-0.5 * math.Pow((st.PH-6.0)/1.8, 2.0))

	wShG := st.ShootDWgPerPlant
	const iDayMJ = 10.0
	// Convert mmol h^-1 g^-1 DM -> mol s^-1 g^-1 DM (multiply by 1e-3 / 3600)
	jMax0 := 1e-3 * (0.0047*iDayMJ + 0.0159) / 3600.0
	alphaAge := 0.0039*iDayMJ + 0.1327
	jMaxN := jMax0 * math.Exp(-alphaAge*wShG)

	totDMGrowthRateKgS := cfg.AFlM2 * dXdDtKgM2S
	totShootDMG := float64(cfg.NPl) * wShG

	cNO3 := math.Max(0, st.IonsMolM3[IonNO3])
	cNH4 := math.Max(0, st.IonsMolM3[IonNH4])
	cP := math.Max(0, st.IonsMolM3[IonP])
	cK := math.Max(0, st.IonsMolM3[IonK])

	mmNO3 := cNO3 / (0.03 + cNO3)
	mmNH4 := cNH4 / (0.02 + cNH4)
	mmP := cP / (0.02 + cP)
	mmK := cK / (0.08 + cK)

	totN := phiDO * phiPH * (cUMM*nuNDM*totDMGrowthRateKgS + (1.0-cUMM)*jMaxN*totShootDMG)
	wNO3 := cNO3 * mmNO3
	wNH4 := 1.2 * cNH4 * mmNH4
	affSum := wNO3 + wNH4
	if affSum > 1e-12 {
		tot[IonNO3] = totN * (wNO3 / affSum)
		tot[IonNH4] = totN * (wNH4 / affSum)
	}
	tot[IonP] = phiDO * phiPH * (cUMM*nuPDM*totDMGrowthRateKgS + (1.0-cUMM)*(nuPDM/nuNDM)*jMaxN*totShootDMG) * mmP
	tot[IonK] = phiDO * phiPH * (cUMM*nuKDM*totDMGrowthRateKgS + (1.0-cUMM)*(nuKDM/nuNDM)*jMaxN*totShootDMG) * mmK

	passive := func(ion Ion, beta, cSat float64) float64 {
		c := math.Max(0, st.IonsMolM3[ion])
		return qWatTotM3S * beta * (c / (1.0 + c/cSat))
	}
	tot[IonCa] = passive(IonCa, 0.65, 15.0)
	tot[IonMg] = passive(IonMg, 0.55, 15.0)
	tot[IonSO4] = passive(IonSO4, 0.50, 15.0)
	tot[IonFe] = passive(IonFe, 0.70, 5.0)
	tot[IonNa] = passive(IonNa, 0.12, 50.0)
	tot[IonCl] = passive(IonCl, 0.18, 50.0)
	return tot
}

func computePrecipitationRate(ion Ion, ions IonVec, ph float64) float64 {
	switch ion {
	case IonFe:
		if ph <= 7.0 {
			return 0
		}
		p := math.Pow(10.0, ph-7.2)
		if p <= 1.0 {
			return 0
		}
		return 1.0e-5 * math.Max(0, ions[IonFe]) * ((p - 1.0) / (p + 1.0))
	case IonCa, IonP:
		h := math.Pow(10.0, 3.0-ph)
		fHPO4 := ka2P / (h + ka2P)
		cHPO4 := math.Max(0, ions[IonP]) * fHPO4
		prod := math.Max(0, ions[IonCa]) * cHPO4
		if prod <= 2.0 {
			return 0
		}
		return 5.0e-7 * (prod/2.0 - 1.0)
	default:
		return 0
	}
}

func computeRootZoneStress(st State) float64 {
	phiEC := math.Min(1.0, st.EC25dSm/0.40) * math.Max(0.0, 1.0-0.04*math.Max(0.0, st.EC25dSm-2.80))
	phiPH := math.Exp(-0.5 * math.Pow((st.PH-6.0)/1.80, 2.0))
	doExcess := math.Max(0.0, st.CDOChOutMgL-1.50)
	phiDO := doExcess / (1.50 + doExcess)
	phiTw := math.Exp(-0.5 * math.Pow((st.TChC-22.0)/8.0, 2.0))

	cN := math.Max(0, st.IonsMolM3[IonNO3]+st.IonsMolM3[IonNH4])
	cP := math.Max(0, st.IonsMolM3[IonP])
	cK := math.Max(0, st.IonsMolM3[IonK])
	phiNut := math.Min(cN/(0.03+cN), math.Min(cP/(0.02+cP), cK/(0.08+cK)))

	return clamp(phiEC*phiPH*phiDO*phiTw*phiNut, 0.0, 1.0)
}

func computeCanopyAndYield(cfg Config, xdKgM2, ec25 float64) (lai, laiEff, ccPct, shDWg, rtDWg, shFWg float64) {
	const (
		cLar      = 75.0
		cTau      = 0.12
		alphaDMC0 = 0.055
		ecThrFW   = 1.96
		bSalFW    = 0.0873
	)
	if cfg.NPl <= 0 || cfg.RhoPl <= 0 || xdKgM2 <= 0 {
		return 0, 0, 0, 0, 0, 0
	}
	lai = cLar * (1.0 - cTau) * xdKgM2
	rectFactor := math.Min(1.0, math.Sqrt(cfg.SPlM/math.Max(1e-4, cfg.WPitchM)))
	laiEff = lai * rectFactor
	ccPct = 100.0 * (1.0 - math.Exp(-0.70*laiEff))

	wdPlantG := 1000.0 * (xdKgM2 / cfg.RhoPl)
	shDWg = (1.0 - cTau) * wdPlantG
	rtDWg = cTau * wdPlantG

	denom := math.Max(0.25, 1.0-bSalFW*math.Max(0.0, ec25-ecThrFW))
	alphaDMC := alphaDMC0 / denom
	shFWg = shDWg / alphaDMC
	return lai, laiEff, ccPct, shDWg, rtDWg, shFWg
}

func outdoorWeather(cfg Config, simTimeSec, dTHW, fHWRad float64) (tOutC, iOutSW, rhOutPct float64) {
	doy := float64(cfg.DOY0) + simTimeSec/86400.0
	hour := math.Mod(simTimeSec/3600.0, 24.0)
	omegaH := (math.Pi / 12.0) * (hour - 12.0)
	deltaSol := 0.409 * math.Sin((2.0*math.Pi/365.0)*doy-1.39)
	sinBeta := math.Sin(cfg.PhiLatRad)*math.Sin(deltaSol) + math.Cos(cfg.PhiLatRad)*math.Cos(deltaSol)*math.Cos(omegaH)

	if sinBeta > 0 {
		iOutSW = 920.0 * sinBeta * (1.0 + fHWRad)
	}
	tSeason := 4.8 * (math.Sin((2.0*math.Pi/365.0)*(doy-105.0)) - math.Sin((2.0*math.Pi/365.0)*(95.0-105.0)))
	tOutC = 21.0 + tSeason + 5.0*math.Sin((2.0*math.Pi/24.0)*(hour-9.0)) + dTHW
	rhOutPct = clamp(62.0-12.0*math.Sin((2.0*math.Pi/24.0)*(hour-9.0)), 25.0, 90.0)
	return tOutC, iOutSW, rhOutPct
}

func trueSensorQuantity(st State, kind string, probeTempBias float64) float64 {
	switch kind {
	case "EC":
		num := 1.0 + 0.0191*(st.TResC-25.0)
		den := 1.0 + 0.0191*(st.TResC+probeTempBias-25.0)
		return st.EC25dSm * (num / den)
	case "pH":
		return 7.0 + (st.PH-7.0)*((st.TResC+273.15)/298.15)
	case "T_w":
		return st.TResC
	case "DO":
		return st.CDOChOutMgL
	case "V_res":
		return st.VResM3 * 1000.0
	case "T_air":
		return st.TAirC
	case "RH":
		return st.RHPct
	case "CO2":
		return st.CO2PPM
	case "RGB":
		return st.CanopyCoverPct
	default:
		return 0
	}
}

func sensorUnit(kind string) string {
	switch kind {
	case "EC":
		return "dS/m"
	case "pH":
		return "pH"
	case "T_w", "T_air":
		return "degC"
	case "DO":
		return "mg/L"
	case "V_res":
		return "L"
	case "RH", "RGB":
		return "%"
	case "CO2":
		return "ppm"
	default:
		return "-"
	}
}

func co2PPMToKgM3(ppm, tAirC, zElevM float64) float64 {
	pBarPa := 101325.0 * math.Pow(1.0-2.25577e-5*zElevM, 5.25588)
	return 1e-6 * ppm * (pBarPa * 0.04401) / (8.3145 * (tAirC + 273.15))
}

func kgM3ToCO2PPM(chiKgM3, tAirC, zElevM float64) float64 {
	pBarPa := 101325.0 * math.Pow(1.0-2.25577e-5*zElevM, 5.25588)
	return 1e6 * chiKgM3 * (8.3145 * (tAirC + 273.15)) / (pBarPa * 0.04401)
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
