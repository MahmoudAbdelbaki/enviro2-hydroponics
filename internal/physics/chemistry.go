package physics

import "math"

// Dissociation constants at 25C in [mol m^-3 = mmol L^-1] (PHYSICS_SPEC.md Eq. 4.3).
const (
	ka1C = 4.46683592e-4  // pKa1,C = 6.35
	ka2C = 4.67735141e-8  // pKa2,C = 10.33
	ka1P = 7.07945784e0   // pKa1,P = 2.15
	ka2P = 6.30957344e-5  // pKa2,P = 7.20
	ka3P = 4.46683592e-10 // pKa3,P = 12.35
	kaN  = 5.62341325e-7  // pKa,N  = 9.25
	kw25 = 1.00e-8        // Kw at 25C in (mol m^-3)^2
	ln10 = 2.302585092994046
)

// IonicStrengthMolL computes molar ionic strength I_str [mol/L] (PHYSICS_SPEC.md Eq. 3.3).
func IonicStrengthMolL(ions IonVec) float64 {
	var sum float64
	for i := 0; i < NumIons; i++ {
		z := IonValence[i]
		c := ions[i]
		if c > 0 {
			sum += z * z * c
		}
	}
	return 0.5 * sum * 1e-3
}

// SolveEquilibriumPH solves Module 4 Equation (4.3) for free proton concentration [H+] [mol/m^3]
// and returns pH = -log10(gamma_1 * [H+] * 10^-3).
// Referenced to the hydroponic zero-proton reference species (H2CO3*, H2PO4-, NH4+) so Eq. (4.1)
// root proton/hydroxyl stoichiometry governs d[Alk]/dt without double-counting H2PO4-/NH4+ depletion.
func SolveEquilibriumPH(alkEqM3, dicMolM3, pTotMolM3, nh4TotMolM3, iStrMolL float64) (ph float64, hMolM3 float64) {
	cT := math.Max(0, dicMolM3)
	cP := math.Max(0, pTotMolM3)
	cN := math.Max(0, nh4TotMolM3)

	evalF := func(h float64) float64 {
		h2 := h * h
		h3 := h2 * h
		// Carbonate alkalinity contribution: [HCO3-] + 2[CO3^2-]
		carb := cT * (ka1C*h + 2*ka1C*ka2C) / (h2 + ka1C*h + ka1C*ka2C)
		// Phosphate contribution relative to H2PO4- reference: [HPO4^2-] + 2[PO4^3-] - [H3PO4]
		phos := cP * (ka1P*ka2P*h + 2*ka1P*ka2P*ka3P - h3) / (h3 + ka1P*h2 + ka1P*ka2P*h + ka1P*ka2P*ka3P)
		// Ammonium deprotonation relative to NH4+ reference: [NH3]
		amm := cN * kaN / (h + kaN)
		oh := kw25 / h
		return alkEqM3 - carb - phos - amm - oh + h
	}

	lo, hi := -21.0, 4.6
	for iter := 0; iter < 28; iter++ {
		mid := 0.5 * (lo + hi)
		hMid := math.Exp(mid)
		if evalF(hMid) < 0 {
			lo = mid
		} else {
			hi = mid
		}
	}

	hMolM3 = math.Exp(0.5 * (lo + hi))
	sqrtI := math.Sqrt(math.Max(0, iStrMolL))
	gamma1 := math.Exp(-ln10 * 0.509 * sqrtI / (1.0 + sqrtI))
	ph = -math.Log10(math.Max(1e-14, gamma1*hMolM3*1e-3))
	return ph, hMolM3
}

// ComputeEC calculates reference EC25 [dS/m] and raw EC(Tw) [dS/m] from the 10 ion species,
// DIC, alkalinity, and pH using Kohlrausch-Onsager theory (PHYSICS_SPEC.md Eq. 3.3).
func ComputeEC(ions IonVec, dicMolM3, ph, hMolM3, twC float64) (ec25, ecRaw float64) {
	iStr := IonicStrengthMolL(ions)
	fAct := math.Max(0.50, 1.0-0.65*math.Sqrt(iStr))

	h := math.Max(1e-11, hMolM3)
	pTot := math.Max(0, ions[IonP])
	fH2PO4 := h / (h + ka2P)
	fHPO4 := ka2P / (h + ka2P)
	cH2PO4 := pTot * fH2PO4
	cHPO4 := pTot * fHPO4

	cHCO3 := math.Max(0, dicMolM3) * (ka1C * h) / (h*h + ka1C*h + ka1C*ka2C)
	cOH := kw25 / h

	condSum := 0.0714*math.Max(0, ions[IonNO3])*1.0 +
		0.0735*math.Max(0, ions[IonNH4])*1.0 +
		0.0360*cH2PO4*1.0 +
		0.0570*cHPO4*2.0 +
		0.0735*math.Max(0, ions[IonK])*1.0 +
		0.0595*math.Max(0, ions[IonCa])*2.0 +
		0.0531*math.Max(0, ions[IonMg])*2.0 +
		0.0800*math.Max(0, ions[IonSO4])*2.0 +
		0.0501*math.Max(0, ions[IonNa])*1.0 +
		0.0763*math.Max(0, ions[IonCl])*1.0 +
		0.0550*math.Max(0, ions[IonFe])*2.0 +
		0.0445*cHCO3*1.0 +
		0.3498*h*1.0 +
		0.1983*cOH*1.0

	ec25 = fAct * condSum
	ecRaw = ec25 * (1.0 + 0.0191*(twC-25.0))
	return ec25, ecRaw
}

// DOSaturationBensonKrause computes equilibrium dissolved oxygen saturation C_DO,sat [mg/L]
// per Module 6 Equation (6.1) (Benson & Krause 1984 / USGS DOTABLES).
func DOSaturationBensonKrause(twC, ec25dSm, zElevM float64) float64 {
	tk := twC + 273.15
	lnC0 := -139.34411 +
		(1.575701e5 / tk) -
		(6.642308e7 / (tk * tk)) +
		(1.243800e10 / (tk * tk * tk)) -
		(8.621949e11 / (tk * tk * tk * tk))
	c0 := math.Exp(lnC0)

	sal := 0.55 * math.Max(0, ec25dSm)
	fS := math.Exp(-sal * (0.017674 - (10.754 / tk) + (2140.7 / (tk * tk))))

	pAtm := math.Pow(1.0-2.25577e-5*zElevM, 5.25588)
	uVap := math.Exp(11.8571 - (3840.70 / tk) - (216961.0 / (tk * tk)))
	theta0 := 0.000975 - 1.426e-5*twC + 6.436e-8*twC*twC
	fP := pAtm * ((1.0 - uVap/pAtm) * (1.0 - theta0*pAtm)) / ((1.0 - uVap) * (1.0 - theta0))

	return c0 * fS * fP
}

// SaturationVaporRelation computes e*(T) [Pa], slope Delta(T) [Pa/K], and saturation absolute
// humidity chi_vap*(T) [kg/m^3] per Module 1 Equation (1.6).
func SaturationVaporRelation(tempC float64) (eStarPa, deltaPaK, chiStarKgM3 float64) {
	eStarPa = 610.78 * math.Exp((17.2694*tempC)/(tempC+237.3))
	deltaPaK = (4098.0 * eStarPa) / ((tempC + 237.3) * (tempC + 237.3))
	chiStarKgM3 = (0.018015 * eStarPa) / (8.3145 * (tempC + 273.15))
	return eStarPa, deltaPaK, chiStarKgM3
}

// StanghelliniTranspiration evaluates Module 8 Equations (8.1)-(8.5) returning
// boundary resistance r_e [s/m], stomatal resistance r_i [s/m], latent heat flux lambda_v*E_can [W/m^2],
// canopy transpiration flux E_can [kg m^-2 s^-1], and sensible heat flux H_can_to_air [W/m^2].
func StanghelliniTranspiration(iCanSW, tAirC, rhPct, co2PPM, lai, uCanMS, lLeafM float64) (re, ri, latentWM2, eCanKgM2S, hCanWM2 float64) {
	const (
		rhoA       = 1.20
		cpA        = 1010.0
		gammaPsych = 66.5
		lambdaV    = 2.45e6
		alphaCanSW = 0.80
		kExtSW     = 0.70
		rMin       = 82.0
	)
	if lLeafM <= 0 {
		lLeafM = 0.10
	}

	re = (1174.0 * math.Sqrt(lLeafM)) / math.Pow(lLeafM*13.76+207.0*uCanMS*uCanMS, 0.25)

	if lai <= 1e-9 {
		return re, 653.0, 0, 0, 0
	}

	rnCan := alphaCanSW * (1.0 - math.Exp(-kExtSW*lai)) * math.Max(0, iCanSW)
	iBarS := rnCan / (2.0 * lai)

	eStar, delta, _ := SaturationVaporRelation(tAirC)
	rhClamped := math.Min(100.0, math.Max(5.0, rhPct))
	eA := (rhClamped / 100.0) * eStar
	vpdKPa := math.Max(0.0, (eStar-eA)/1000.0)

	// Eq. 8.5: Multiplicative stomatal resistance r_i
	f1 := (iBarS + 4.30) / (iBarS + 0.54)
	var f2, f3, f4 float64
	if iBarS > 0 {
		f2 = 1.0 + 0.023*(tAirC-24.5)*(tAirC-24.5)
		f3 = math.Min(1.5, 1.0+6.1e-7*(co2PPM-200.0)*(co2PPM-200.0))
		f4 = math.Min(3.8, 1.0+4.45*vpdKPa*vpdKPa)
	} else {
		f2 = 1.0 + 0.005*(tAirC-13.6)*(tAirC-13.6)
		f3 = 1.0
		f4 = 3.836
	}
	ri = rMin * f1 * f2 * f3 * f4

	// Eq. 8.1: Combination transpiration equation
	num := delta*rnCan + ((2.0*lai*rhoA*cpA)/re)*(eStar-eA)
	den := delta + gammaPsych*(1.0+ri/re)
	latentWM2 = math.Max(0.0, num/den)
	eCanKgM2S = latentWM2 / lambdaV
	hCanWM2 = rnCan - latentWM2
	return re, ri, latentWM2, eCanKgM2S, hCanWM2
}
