package domain

import "time"

// SchemaVersionV1 is the supported FarmSpec JSON schema version.
const SchemaVersionV1 = "1.0"

// FarmSpec represents the user-authored hydroponic NFT lettuce farm JSON.
// Every physical component carries a required ID for Three.js 3D addressing.
type FarmSpec struct {
	SchemaVersion   string             `json:"schema_version"`
	Name            string             `json:"name"`
	Location        LocationSpec       `json:"location"`
	Enclosure       EnclosureSpec      `json:"enclosure"`
	Reservoir       ReservoirSpec      `json:"reservoir"`
	Pump            PumpSpec           `json:"pump"`
	Aerator         AeratorSpec        `json:"aerator"`
	Fans            FansSpec           `json:"fans"`
	Channels        []ChannelSpec      `json:"channels"`
	SourceWater     WaterChemistrySpec `json:"source_water"`
	InitialSolution WaterChemistrySpec `json:"initial_solution"`
	DosingStocks    DosingStocksSpec   `json:"dosing_stocks"`
	Sensors         []SensorSpec       `json:"sensors"`
}

// FarmRecord wraps a persisted FarmSpec with server metadata.
type FarmRecord struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	SchemaVersion string    `json:"schema_version"`
	Spec          FarmSpec  `json:"spec"`
	CreatedAt     time.Time `json:"created_at"`
}

type LocationSpec struct {
	LatDeg     float64 `json:"lat_deg"`
	LonDeg     float64 `json:"lon_deg"`
	ElevationM float64 `json:"elevation_m"`
	StartDOY   int     `json:"start_doy"`
}

type EnclosureSpec struct {
	ID                 string  `json:"id"`
	Type               string  `json:"type"` // open_air, shade_net, greenhouse, indoor_LED
	FloorAreaM2        float64 `json:"floor_area_m2"`
	AirVolumeM3        float64 `json:"air_volume_m3"`
	CoverTransmittance float64 `json:"cover_transmittance"`
	VentConductanceMS  float64 `json:"vent_conductance_m_s"`
}

type ReservoirSpec struct {
	ID                   string  `json:"id"`
	InitialVolumeL       float64 `json:"initial_volume_l"`
	MaxVolumeL           float64 `json:"max_volume_l"`
	SurfaceAreaM2        float64 `json:"surface_area_m2"`
	WallConductanceWM2K  float64 `json:"wall_conductance_w_m2_k"`
	Placement            string  `json:"placement"` // indoor, shaded, sun
}

type PumpSpec struct {
	ID            string  `json:"id"`
	RatedFlowLMin float64 `json:"rated_flow_l_min"`
	InitialHealth float64 `json:"initial_health"`
}

type AeratorSpec struct {
	ID          string  `json:"id"`
	AirFlowLMin float64 `json:"air_flow_l_min"`
	OTRStdGH    float64 `json:"otr_std_g_h"`
}

type FansSpec struct {
	ID          string  `json:"id"`
	Placement   string  `json:"placement"` // none, exhaust, horizontal_canopy, vertical_destrat
	AirflowM3S  float64 `json:"airflow_m3_s"`
}

type ChannelSpec struct {
	ID                  string  `json:"id"`
	LengthM             float64 `json:"length_m"`
	WidthM              float64 `json:"width_m"`
	Slope               float64 `json:"slope"`
	PlantSpacingM       float64 `json:"plant_spacing_m"`
	PlantsPerChannel    int     `json:"plants_per_channel"`
	InitialPlantAgeDays float64 `json:"initial_plant_age_days"`
}

type WaterChemistrySpec struct {
	Profile        string        `json:"profile"` // hoagland_lettuce_std, ro_pure, egypt_nile_fresh, egypt_delta_brackish, custom
	AlkalinityMeqL *float64      `json:"alkalinity_meq_l,omitempty"`
	IonsMmolL      *IonOverrides `json:"ions_mmol_l,omitempty"`
}

type DosingStocksSpec struct {
	StockA StockTankSpec `json:"stock_a"`
	StockB StockTankSpec `json:"stock_b"`
	Acid   StockTankSpec `json:"acid"`
	Base   StockTankSpec `json:"base"`
}

type StockTankSpec struct {
	ID                string        `json:"id"`
	Profile           string        `json:"profile"` // standard_part_a, standard_part_b, nitric_acid_0_5M, potassium_hydroxide_0_5M, custom
	NetAlkalinityMeqL *float64      `json:"net_alkalinity_meq_l,omitempty"`
	IonsMmolL         *IonOverrides `json:"ions_mmol_l,omitempty"`
}

type IonOverrides struct {
	NO3  *float64 `json:"NO3,omitempty"`
	NH4  *float64 `json:"NH4,omitempty"`
	PTot *float64 `json:"P_tot,omitempty"`
	K    *float64 `json:"K,omitempty"`
	Ca   *float64 `json:"Ca,omitempty"`
	Mg   *float64 `json:"Mg,omitempty"`
	SO4  *float64 `json:"SO4,omitempty"`
	Na   *float64 `json:"Na,omitempty"`
	Cl   *float64 `json:"Cl,omitempty"`
	Fe   *float64 `json:"Fe,omitempty"`
}

type SensorSpec struct {
	ID           string  `json:"id"`
	Kind         string  `json:"kind"` // EC, pH, T_w, DO, T_air, RH, CO2, V_res, RGB
	AttachedToID string  `json:"attached_to_id"`
	Accuracy     float64 `json:"accuracy"`
	DriftPerDay  float64 `json:"drift_per_day"`
	DropoutProb  float64 `json:"dropout_prob,omitempty"`
}

// DefaultDemoFarm returns a scientifically valid Egyptian NFT lettuce greenhouse configuration
// matching PHYSICS_SPEC.md Section 0.1 & Section 15.3 baseline geometry (250L reservoir, 3 channels, 24 plants).
func DefaultDemoFarm() FarmSpec {
	return FarmSpec{
		SchemaVersion: SchemaVersionV1,
		Name:          "Sensor X Cairo NFT Lettuce Twin (1x Baseline)",
		Location: LocationSpec{
			LatDeg:     30.0444, // Cairo, Egypt
			LonDeg:     31.2357,
			ElevationM: 23.0,
			StartDOY:   95,
		},
		Enclosure: EnclosureSpec{
			ID:                 "enclosure-1",
			Type:               "greenhouse",
			FloorAreaM2:        1.50,
			AirVolumeM3:        4.50,
			CoverTransmittance: 0.75,
			VentConductanceMS:  0.015,
		},
		Reservoir: ReservoirSpec{
			ID:                  "reservoir-1",
			InitialVolumeL:      250.0,
			MaxVolumeL:          300.0,
			SurfaceAreaM2:       0.50,
			WallConductanceWM2K: 2.50,
			Placement:           "indoor",
		},
		Pump: PumpSpec{
			ID:            "pump-1",
			RatedFlowLMin: 4.5, // 1.5 L/min per channel across 3 channels
			InitialHealth: 1.0,
		},
		Aerator: AeratorSpec{
			ID:          "aerator-1",
			AirFlowLMin: 5.0,
			OTRStdGH:    2.7,
		},
		Fans: FansSpec{
			ID:         "fans-1",
			Placement:  "horizontal_canopy",
			AirflowM3S: 0.15,
		},
		Channels: []ChannelSpec{
			{
				ID:                  "ch-1",
				LengthM:             2.0,
				WidthM:              0.10,
				Slope:               0.02,
				PlantSpacingM:       0.20,
				PlantsPerChannel:    8,
				InitialPlantAgeDays: 5.0,
			},
			{
				ID:                  "ch-2",
				LengthM:             2.0,
				WidthM:              0.10,
				Slope:               0.02,
				PlantSpacingM:       0.20,
				PlantsPerChannel:    8,
				InitialPlantAgeDays: 5.0,
			},
			{
				ID:                  "ch-3",
				LengthM:             2.0,
				WidthM:              0.10,
				Slope:               0.02,
				PlantSpacingM:       0.20,
				PlantsPerChannel:    8,
				InitialPlantAgeDays: 5.0,
			},
		},
		SourceWater: WaterChemistrySpec{
			Profile: "egypt_nile_fresh",
		},
		InitialSolution: WaterChemistrySpec{
			Profile: "hoagland_lettuce_std",
		},
		DosingStocks: DosingStocksSpec{
			StockA: StockTankSpec{ID: "stock-a", Profile: "standard_part_a"},
			StockB: StockTankSpec{ID: "stock-b", Profile: "standard_part_b"},
			Acid:   StockTankSpec{ID: "stock-acid", Profile: "nitric_acid_0_5M"},
			Base:   StockTankSpec{ID: "stock-base", Profile: "potassium_hydroxide_0_5M"},
		},
		Sensors: []SensorSpec{
			{ID: "sen-ec-1", Kind: "EC", AttachedToID: "reservoir-1", Accuracy: 0.02, DriftPerDay: 0.002},
			{ID: "sen-ph-1", Kind: "pH", AttachedToID: "reservoir-1", Accuracy: 0.03, DriftPerDay: 0.005},
			{ID: "sen-tw-1", Kind: "T_w", AttachedToID: "reservoir-1", Accuracy: 0.10, DriftPerDay: 0.0},
			{ID: "sen-do-1", Kind: "DO", AttachedToID: "ch-1", Accuracy: 0.08, DriftPerDay: -0.01},
			{ID: "sen-vres-1", Kind: "V_res", AttachedToID: "reservoir-1", Accuracy: 0.50, DriftPerDay: 0.0},
			{ID: "sen-tair-1", Kind: "T_air", AttachedToID: "enclosure-1", Accuracy: 0.15, DriftPerDay: 0.0},
			{ID: "sen-rh-1", Kind: "RH", AttachedToID: "enclosure-1", Accuracy: 1.0, DriftPerDay: 0.05},
			{ID: "sen-rgb-1", Kind: "RGB", AttachedToID: "enclosure-1", Accuracy: 0.8, DriftPerDay: 0.0},
		},
	}
}
