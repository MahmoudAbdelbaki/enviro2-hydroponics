package domain

import "time"

// ValidationResponse is returned by POST /api/v1/farms/validate.
type ValidationResponse struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationIssue `json:"errors"`
}

// ValidationIssue pinpoints a structural or physics-range violation to a specific 3D component_id.
type ValidationIssue struct {
	ComponentID  string        `json:"component_id"`
	JSONPath     string        `json:"json_path"`
	Code         string        `json:"code"`
	Message      string        `json:"message"`
	Actual       any           `json:"actual,omitempty"`
	AllowedRange *AllowedRange `json:"allowed_range,omitempty"`
}

type AllowedRange struct {
	Min  *float64 `json:"min,omitempty"`
	Max  *float64 `json:"max,omitempty"`
	Unit string   `json:"unit,omitempty"`
}

type ClockMode string

const (
	ClockPaused  ClockMode = "paused"
	ClockRunning ClockMode = "running"
)

type FaultKind string

const (
	FaultPumpDegradation   FaultKind = "pump_degradation"
	FaultAerationLoss      FaultKind = "aeration_loss"
	FaultHeatWave          FaultKind = "heat_wave"
	FaultProbeDrift        FaultKind = "probe_drift"
	FaultNutrientImbalance FaultKind = "nutrient_imbalance"
	FaultReservoirLeak     FaultKind = "reservoir_leak"
)

type FaultSpec struct {
	Kind              FaultKind `json:"kind"`
	TargetComponentID string    `json:"target_component_id"`
	Intensity         float64   `json:"intensity"`
	TriggerAtSimSec   float64   `json:"trigger_at_sim_sec"`
	Clear             bool      `json:"clear,omitempty"`
}

type SimulationStatus struct {
	ID              string      `json:"id"`
	FarmID          string      `json:"farm_id"`
	Seed            int64       `json:"seed"`
	StepSeconds     int         `json:"step_seconds"`
	Mode            ClockMode   `json:"mode"`
	SpeedMultiplier float64     `json:"speed_multiplier"`
	TickIndex       int64       `json:"tick_index"`
	SimTimeSec      float64     `json:"sim_time_sec"`
	SimDays         float64     `json:"sim_days"`
	ActiveFaults    []FaultSpec `json:"active_faults"`
	DroppedBatches  uint64      `json:"dropped_batches"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
}

// SensorReading represents a Module 11 noisy probe observation.
// Value is nil when a Bernoulli packet dropout occurs.
type SensorReading struct {
	SimulationID string   `json:"simulation_id,omitempty"`
	TickIndex    int64    `json:"tick_index"`
	SimTimeSec   float64  `json:"sim_time_sec"`
	SensorID     string   `json:"sensor_id"`
	ComponentID  string   `json:"component_id"`
	Kind         string   `json:"kind"`
	Value        *float64 `json:"value"`
	Unit         string   `json:"unit"`
}

// GroundTruthState exposes the true conserved physical state for operator debugging
// and offline ML training dataset labeling. Never exposed to MCP or /readings.
type GroundTruthState struct {
	SimTimeSec       float64            `json:"sim_time_sec"`
	TickIndex        int64              `json:"tick_index"`
	VResL            float64            `json:"v_res_l"`
	VChTotL          float64            `json:"v_ch_tot_l"`
	TAirC            float64            `json:"t_air_c"`
	RHPct            float64            `json:"rh_pct"`
	CO2PPM           float64            `json:"co2_ppm"`
	TResC            float64            `json:"t_res_c"`
	TChOutC          float64            `json:"t_ch_out_c"`
	PH               float64            `json:"ph"`
	EC25dSm          float64            `json:"ec25_ds_m"`
	ECRawdSm         float64            `json:"ec_raw_ds_m"`
	AlkalinityMeqL   float64            `json:"alkalinity_meq_l"`
	DICMmolL         float64            `json:"dic_mmol_l"`
	CDOResMgL        float64            `json:"c_do_res_mg_l"`
	CDOChOutMgL      float64            `json:"c_do_ch_out_mg_l"`
	FilmDepthMM      float64            `json:"film_depth_mm"`
	ResidenceTimeSec float64            `json:"residence_time_sec"`
	LAI              float64            `json:"lai"`
	CanopyCoverPct   float64            `json:"canopy_cover_pct"`
	ShootDWgPerPlant float64            `json:"shoot_dw_g_per_plant"`
	RootDWgPerPlant  float64            `json:"root_dw_g_per_plant"`
	ShootFWgPerPlant float64            `json:"shoot_fw_g_per_plant"`
	StressFactor     float64            `json:"stress_factor"`
	IonsMmolL        map[string]float64 `json:"ions_mmol_l"`
	ActiveFaults     []FaultSpec        `json:"active_faults"`
}

type Alert struct {
	ID           string    `json:"id"`
	SimulationID string    `json:"simulation_id"`
	SimTimeSec   float64   `json:"sim_time_sec"`
	ComponentID  string    `json:"component_id"`
	Severity     string    `json:"severity"` // info, warning, critical
	Code         string    `json:"code"`
	Message      string    `json:"message"`
	CreatedAt    time.Time `json:"created_at"`
}

type CommandAction string

const (
	ActionDose               CommandAction = "dose"
	ActionRefillWater        CommandAction = "refill_water"
	ActionSetPumpThrottle    CommandAction = "set_pump_throttle"
	ActionSetAeratorThrottle CommandAction = "set_aerator_throttle"
	ActionSetFanThrottle     CommandAction = "set_fan_throttle"
)

type CommandRequest struct {
	TargetComponentID string        `json:"target_component_id"`
	Action            CommandAction `json:"action"`
	DoseStockAML      float64       `json:"dose_stock_a_ml,omitempty"`
	DoseStockBML      float64       `json:"dose_stock_b_ml,omitempty"`
	DoseAcidML        float64       `json:"dose_acid_ml,omitempty"`
	DoseBaseML        float64       `json:"dose_base_ml,omitempty"`
	RefillWaterL      float64       `json:"refill_water_l,omitempty"`
	Throttle          *float64      `json:"throttle,omitempty"`
	Reason            string        `json:"reason"`
}

type CommandStatus string

const (
	CommandAccepted       CommandStatus = "accepted"
	CommandRejectedSafety CommandStatus = "rejected_safety"
)

type CommandRecord struct {
	ID                string         `json:"id"`
	SimulationID      string         `json:"simulation_id"`
	SimTimeSec        float64        `json:"sim_time_sec"`
	TargetComponentID string         `json:"target_component_id"`
	Action            CommandAction  `json:"action"`
	Payload           CommandRequest `json:"payload"`
	Reason            string         `json:"reason"`
	Status            CommandStatus  `json:"status"`
	RejectionCode     string         `json:"rejection_code,omitempty"`
	RejectionMessage  string         `json:"rejection_message,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
}

// Actuation holds pending physical actuator inputs to be applied over the next simulation step.
type Actuation struct {
	DoseStockAM3     float64
	DoseStockBM3     float64
	DoseAcidM3       float64
	DoseBaseM3       float64
	RefillWaterM3    float64
	PumpThrottle     *float64
	AeratorThrottle  *float64
	FanThrottle      *float64
}
