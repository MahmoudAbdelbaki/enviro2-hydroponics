package validate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/abdelbaky/hydro/internal/domain"
)

var componentIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$`)

type componentKind string

const (
	kindEnclosure componentKind = "enclosure"
	kindReservoir componentKind = "reservoir"
	kindPump      componentKind = "pump"
	kindAerator   componentKind = "aerator"
	kindFans      componentKind = "fans"
	kindChannel   componentKind = "channel"
	kindStock     componentKind = "stock"
	kindSensor    componentKind = "sensor"
)

func floatPtr(v float64) *float64 { return &v }

// Farm runs all structural, referential, single-field physics-range, and coupled
// cross-component hydraulic/geometric rules on a FarmSpec.
// It never stops on the first error so the Three.js frontend can highlight all offending component IDs at once.
func Farm(spec domain.FarmSpec) []domain.ValidationIssue {
	var issues []domain.ValidationIssue

	addIssue := func(compID, jsonPath, code, msg string, actual any, rng *domain.AllowedRange) {
		if compID == "" {
			compID = "farm-root"
		}
		issues = append(issues, domain.ValidationIssue{
			ComponentID:  compID,
			JSONPath:     jsonPath,
			Code:         code,
			Message:      msg,
			Actual:       actual,
			AllowedRange: rng,
		})
	}

	if spec.SchemaVersion != domain.SchemaVersionV1 {
		addIssue("farm-root", "$.schema_version", "INVALID_SCHEMA_VERSION",
			fmt.Sprintf("schema_version must be %q", domain.SchemaVersionV1), spec.SchemaVersion, nil)
	}
	if strings.TrimSpace(spec.Name) == "" {
		addIssue("farm-root", "$.name", "REQUIRED_FIELD", "farm name must not be empty", spec.Name, nil)
	}

	// Track component IDs globally for uniqueness and sensor attachment lookup.
	seenIDs := make(map[string]string)
	compKinds := make(map[string]componentKind)
	registerID := func(id, jsonPath string, k componentKind) {
		if !componentIDPattern.MatchString(id) {
			addIssue(id, jsonPath, "INVALID_COMPONENT_ID",
				"component id must match ^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$", id, nil)
			return
		}
		if prevPath, exists := seenIDs[id]; exists {
			addIssue(id, jsonPath, "DUPLICATE_COMPONENT_ID",
				fmt.Sprintf("component id %q is already used at %s", id, prevPath), id, nil)
			return
		}
		seenIDs[id] = jsonPath
		compKinds[id] = k
	}

	// Location rules (PHYSICS_SPEC.md Sec. 0.1)
	if spec.Location.LatDeg < -66.5 || spec.Location.LatDeg > 66.5 {
		addIssue("farm-root", "$.location.lat_deg", "PHYSICS_RANGE_VIOLATION",
			"latitude must be within [-66.5, 66.5] degrees", spec.Location.LatDeg,
			&domain.AllowedRange{Min: floatPtr(-66.5), Max: floatPtr(66.5), Unit: "deg"})
	}
	if spec.Location.LonDeg < -180.0 || spec.Location.LonDeg > 180.0 {
		addIssue("farm-root", "$.location.lon_deg", "PHYSICS_RANGE_VIOLATION",
			"longitude must be within [-180.0, 180.0] degrees", spec.Location.LonDeg,
			&domain.AllowedRange{Min: floatPtr(-180.0), Max: floatPtr(180.0), Unit: "deg"})
	}
	if spec.Location.ElevationM < -50.0 || spec.Location.ElevationM > 4000.0 {
		addIssue("farm-root", "$.location.elevation_m", "PHYSICS_RANGE_VIOLATION",
			"elevation z_elev must be within [-50, 4000] m", spec.Location.ElevationM,
			&domain.AllowedRange{Min: floatPtr(-50.0), Max: floatPtr(4000.0), Unit: "m"})
	}
	if spec.Location.StartDOY < 1 || spec.Location.StartDOY > 365 {
		addIssue("farm-root", "$.location.start_doy", "PHYSICS_RANGE_VIOLATION",
			"start_doy must be in [1, 365]", spec.Location.StartDOY,
			&domain.AllowedRange{Min: floatPtr(1), Max: floatPtr(365), Unit: "day"})
	}

	// Enclosure rules (PHYSICS_SPEC.md Sec. 0.1)
	encID := spec.Enclosure.ID
	registerID(encID, "$.enclosure.id", kindEnclosure)
	switch spec.Enclosure.Type {
	case "open_air", "shade_net", "greenhouse", "indoor_LED":
	default:
		addIssue(encID, "$.enclosure.type", "INVALID_ENUM",
			"enclosure.type must be one of: open_air, shade_net, greenhouse, indoor_LED", spec.Enclosure.Type, nil)
	}
	if spec.Enclosure.FloorAreaM2 <= 0 {
		addIssue(encID, "$.enclosure.floor_area_m2", "PHYSICS_RANGE_VIOLATION",
			"cropped floor area A_fl must be > 0 m^2", spec.Enclosure.FloorAreaM2,
			&domain.AllowedRange{Min: floatPtr(0.01), Unit: "m^2"})
	}
	if spec.Enclosure.AirVolumeM3 <= 0 {
		addIssue(encID, "$.enclosure.air_volume_m3", "PHYSICS_RANGE_VIOLATION",
			"enclosure internal air volume V_enc must be > 0 m^3", spec.Enclosure.AirVolumeM3,
			&domain.AllowedRange{Min: floatPtr(0.01), Unit: "m^3"})
	}
	if spec.Enclosure.CoverTransmittance < 0.0 || spec.Enclosure.CoverTransmittance > 1.0 {
		addIssue(encID, "$.enclosure.cover_transmittance", "PHYSICS_RANGE_VIOLATION",
			"cover transmittance tau_cov must be in [0.0, 1.0]", spec.Enclosure.CoverTransmittance,
			&domain.AllowedRange{Min: floatPtr(0.0), Max: floatPtr(1.0), Unit: "-"})
	}
	if spec.Enclosure.VentConductanceMS < 0.0 || spec.Enclosure.VentConductanceMS > 5.0 {
		addIssue(encID, "$.enclosure.vent_conductance_m_s", "PHYSICS_RANGE_VIOLATION",
			"passive ventilation conductance U_vent must be in [0.0, 5.0] m/s", spec.Enclosure.VentConductanceMS,
			&domain.AllowedRange{Min: floatPtr(0.0), Max: floatPtr(5.0), Unit: "m/s"})
	}

	// Reservoir rules (PHYSICS_SPEC.md Sec. 0.1)
	resID := spec.Reservoir.ID
	registerID(resID, "$.reservoir.id", kindReservoir)
	if spec.Reservoir.InitialVolumeL <= 0 {
		addIssue(resID, "$.reservoir.initial_volume_l", "PHYSICS_RANGE_VIOLATION",
			"initial reservoir volume V_res,0 must be > 0 L", spec.Reservoir.InitialVolumeL,
			&domain.AllowedRange{Min: floatPtr(1.0), Unit: "L"})
	}
	if spec.Reservoir.MaxVolumeL < spec.Reservoir.InitialVolumeL {
		addIssue(resID, "$.reservoir.max_volume_l", "GEOMETRY_CONFLICT",
			"reservoir max_volume_l must be >= initial_volume_l", spec.Reservoir.MaxVolumeL,
			&domain.AllowedRange{Min: floatPtr(spec.Reservoir.InitialVolumeL), Unit: "L"})
	}
	if spec.Reservoir.SurfaceAreaM2 <= 0 {
		addIssue(resID, "$.reservoir.surface_area_m2", "PHYSICS_RANGE_VIOLATION",
			"reservoir free water surface area A_res must be > 0 m^2", spec.Reservoir.SurfaceAreaM2,
			&domain.AllowedRange{Min: floatPtr(0.01), Unit: "m^2"})
	}
	if spec.Reservoir.WallConductanceWM2K < 0.2 || spec.Reservoir.WallConductanceWM2K > 15.0 {
		addIssue(resID, "$.reservoir.wall_conductance_w_m2_k", "PHYSICS_RANGE_VIOLATION",
			"reservoir wall heat transfer conductance U_res must be in [0.2, 15.0] W m^-2 K^-1",
			spec.Reservoir.WallConductanceWM2K,
			&domain.AllowedRange{Min: floatPtr(0.2), Max: floatPtr(15.0), Unit: "W/(m^2*K)"})
	}
	switch spec.Reservoir.Placement {
	case "indoor", "shaded", "sun":
	default:
		addIssue(resID, "$.reservoir.placement", "INVALID_ENUM",
			"reservoir.placement must be one of: indoor, shaded, sun", spec.Reservoir.Placement, nil)
	}

	// Pump rules (PHYSICS_SPEC.md Sec. 0.1)
	pumpID := spec.Pump.ID
	registerID(pumpID, "$.pump.id", kindPump)
	if spec.Pump.RatedFlowLMin <= 0 {
		addIssue(pumpID, "$.pump.rated_flow_l_min", "PHYSICS_RANGE_VIOLATION",
			"pump rated volumetric flow Q_pump,rated must be > 0 L/min", spec.Pump.RatedFlowLMin,
			&domain.AllowedRange{Min: floatPtr(0.1), Unit: "L/min"})
	}
	if spec.Pump.InitialHealth < 0.0 || spec.Pump.InitialHealth > 1.0 {
		addIssue(pumpID, "$.pump.initial_health", "PHYSICS_RANGE_VIOLATION",
			"pump health factor eta_pump must be in [0.0, 1.0]", spec.Pump.InitialHealth,
			&domain.AllowedRange{Min: floatPtr(0.0), Max: floatPtr(1.0), Unit: "-"})
	}

	// Aerator rules
	aerID := spec.Aerator.ID
	registerID(aerID, "$.aerator.id", kindAerator)
	if spec.Aerator.AirFlowLMin < 0 {
		addIssue(aerID, "$.aerator.air_flow_l_min", "PHYSICS_RANGE_VIOLATION",
			"aerator air flow Q_air must be >= 0 L/min", spec.Aerator.AirFlowLMin,
			&domain.AllowedRange{Min: floatPtr(0.0), Unit: "L/min"})
	}
	if spec.Aerator.OTRStdGH < 0 {
		addIssue(aerID, "$.aerator.otr_std_g_h", "PHYSICS_RANGE_VIOLATION",
			"aerator standard oxygen transfer rating OTR_std must be >= 0 g/h", spec.Aerator.OTRStdGH,
			&domain.AllowedRange{Min: floatPtr(0.0), Unit: "g/h"})
	}

	// Fans rules
	fanID := spec.Fans.ID
	registerID(fanID, "$.fans.id", kindFans)
	switch spec.Fans.Placement {
	case "none", "exhaust", "horizontal_canopy", "vertical_destrat":
	default:
		addIssue(fanID, "$.fans.placement", "INVALID_ENUM",
			"fans.placement must be one of: none, exhaust, horizontal_canopy, vertical_destrat", spec.Fans.Placement, nil)
	}
	if spec.Fans.AirflowM3S < 0 {
		addIssue(fanID, "$.fans.airflow_m3_s", "PHYSICS_RANGE_VIOLATION",
			"fan volumetric airflow Q_fan must be >= 0 m^3/s", spec.Fans.AirflowM3S,
			&domain.AllowedRange{Min: floatPtr(0.0), Unit: "m^3/s"})
	}

	// Channels rules (PHYSICS_SPEC.md Sec. 0.1, Module 7 & Sec. 14.1)
	if len(spec.Channels) == 0 {
		addIssue("farm-root", "$.channels", "PHYSICS_RANGE_VIOLATION",
			"at least 1 NFT channel (N_ch >= 1) is required", 0,
			&domain.AllowedRange{Min: floatPtr(1), Unit: "channels"})
	}

	var totalChannelArea float64
	for i, ch := range spec.Channels {
		pathPrefix := fmt.Sprintf("$.channels[%d]", i)
		registerID(ch.ID, pathPrefix+".id", kindChannel)

		if ch.LengthM <= 0 || ch.LengthM > 50.0 {
			addIssue(ch.ID, pathPrefix+".length_m", "PHYSICS_RANGE_VIOLATION",
				"channel length L_ch must be in (0, 50.0] m", ch.LengthM,
				&domain.AllowedRange{Min: floatPtr(0.1), Max: floatPtr(50.0), Unit: "m"})
		}
		if ch.WidthM <= 0 || ch.WidthM > 1.0 {
			addIssue(ch.ID, pathPrefix+".width_m", "PHYSICS_RANGE_VIOLATION",
				"channel width W_ch must be in (0, 1.0] m", ch.WidthM,
				&domain.AllowedRange{Min: floatPtr(0.02), Max: floatPtr(1.0), Unit: "m"})
		}
		if ch.Slope < 0.005 || ch.Slope > 0.05 {
			addIssue(ch.ID, pathPrefix+".slope", "PHYSICS_RANGE_VIOLATION",
				"channel longitudinal bed slope S_0 must be in [0.005, 0.05] m/m (0.5% to 5%)", ch.Slope,
				&domain.AllowedRange{Min: floatPtr(0.005), Max: floatPtr(0.05), Unit: "m/m"})
		}
		if ch.PlantSpacingM <= 0 {
			addIssue(ch.ID, pathPrefix+".plant_spacing_m", "PHYSICS_RANGE_VIOLATION",
				"plant spacing s_pl must be > 0 m", ch.PlantSpacingM,
				&domain.AllowedRange{Min: floatPtr(0.01), Unit: "m"})
		}
		if ch.PlantsPerChannel < 0 || ch.PlantsPerChannel > 500 {
			addIssue(ch.ID, pathPrefix+".plants_per_channel", "PHYSICS_RANGE_VIOLATION",
				"plants_per_channel N_pl,ch must be in [0, 500]", ch.PlantsPerChannel,
				&domain.AllowedRange{Min: floatPtr(0), Max: floatPtr(500), Unit: "plants"})
		}
		if ch.PlantsPerChannel > 0 && ch.LengthM > 0 && ch.PlantSpacingM > 0 {
			maxSpacing := ch.LengthM / float64(ch.PlantsPerChannel)
			if ch.PlantSpacingM > maxSpacing+1e-9 {
				addIssue(ch.ID, pathPrefix+".plant_spacing_m", "GEOMETRY_CONFLICT",
					fmt.Sprintf("plant spacing s_pl (%.3f m) * N_pl,ch (%d) exceeds channel length L_ch (%.3f m)",
						ch.PlantSpacingM, ch.PlantsPerChannel, ch.LengthM),
					ch.PlantSpacingM,
					&domain.AllowedRange{Min: floatPtr(0.01), Max: floatPtr(maxSpacing), Unit: "m"})
			}
		}
		if ch.InitialPlantAgeDays < 0.0 || ch.InitialPlantAgeDays > 40.0 {
			addIssue(ch.ID, pathPrefix+".initial_plant_age_days", "PHYSICS_RANGE_VIOLATION",
				"initial plant age d_0 must be in [0, 40] days (pre-bolting vegetative envelope)", ch.InitialPlantAgeDays,
				&domain.AllowedRange{Min: floatPtr(0.0), Max: floatPtr(40.0), Unit: "days"})
		}

		// Check parallel bank uniformity against channel 0
		if i > 0 {
			ref := spec.Channels[0]
			if math.Abs(ch.LengthM-ref.LengthM) > 1e-6 || math.Abs(ch.WidthM-ref.WidthM) > 1e-6 ||
				math.Abs(ch.Slope-ref.Slope) > 1e-6 || ch.PlantsPerChannel != ref.PlantsPerChannel ||
				math.Abs(ch.PlantSpacingM-ref.PlantSpacingM) > 1e-6 ||
				math.Abs(ch.InitialPlantAgeDays-ref.InitialPlantAgeDays) > 1e-6 {
				addIssue(ch.ID, pathPrefix, "PARALLEL_MANIFOLD_MISMATCH",
					fmt.Sprintf("parallel NFT channel %q must match channel %q geometry and planting density", ch.ID, ref.ID),
					ch.ID, nil)
			}
		}

		if ch.LengthM > 0 && ch.WidthM > 0 {
			totalChannelArea += ch.LengthM * ch.WidthM
		}
	}

	// Coupled geometry check: A_fl >= sum(L_ch * W_ch) (PHYSICS_SPEC.md Sec. 0.1)
	if spec.Enclosure.FloorAreaM2 > 0 && totalChannelArea > spec.Enclosure.FloorAreaM2+1e-9 {
		addIssue(encID, "$.enclosure.floor_area_m2", "GEOMETRY_CONFLICT",
			fmt.Sprintf("enclosure floor area A_fl (%.2f m^2) must be >= total channel footprint A_ch,tot (%.2f m^2)",
				spec.Enclosure.FloorAreaM2, totalChannelArea),
			spec.Enclosure.FloorAreaM2,
			&domain.AllowedRange{Min: floatPtr(totalChannelArea), Unit: "m^2"})
	}

	// Coupled Manning hydraulics check (Module 7 Eq. 7.1 & Sec. 14.1: h_ch in [0.5 mm, 25 mm])
	if len(spec.Channels) > 0 && spec.Pump.RatedFlowLMin > 0 && spec.Pump.InitialHealth > 0 {
		ch0 := spec.Channels[0]
		if ch0.WidthM > 0 && ch0.Slope >= 0.005 && ch0.Slope <= 0.05 {
			qTotM3S := (spec.Pump.RatedFlowLMin * spec.Pump.InitialHealth) / 60000.0
			qCh := qTotM3S / float64(len(spec.Channels))
			const nPVC = 0.010
			const hPuddle = 0.0005 // 0.5 mm
			hChM := hPuddle + math.Pow((nPVC*qCh)/(ch0.WidthM*math.Sqrt(ch0.Slope)), 0.6)
			hChMM := hChM * 1000.0
			if hChMM > 25.0 {
				addIssue(pumpID, "$.pump.rated_flow_l_min", "HYDRAULIC_FILM_DEPTH_VIOLATION",
					fmt.Sprintf("Manning NFT sheet film depth h_ch (%.2f mm) exceeds 25.0 mm shallow-film limit", hChMM),
					hChMM,
					&domain.AllowedRange{Min: floatPtr(0.5), Max: floatPtr(25.0), Unit: "mm"})
			}
		}
	}

	// Water chemistry & dosing stocks
	validateWaterSpec := func(ws domain.WaterChemistrySpec, path string) {
		switch ws.Profile {
		case "hoagland_lettuce_std", "ro_pure", "egypt_nile_fresh", "egypt_delta_brackish", "custom":
		default:
			addIssue("farm-root", path+".profile", "INVALID_ENUM",
				"water profile must be one of: hoagland_lettuce_std, ro_pure, egypt_nile_fresh, egypt_delta_brackish, custom",
				ws.Profile, nil)
		}
		if ws.AlkalinityMeqL != nil && *ws.AlkalinityMeqL < 0 {
			addIssue("farm-root", path+".alkalinity_meq_l", "PHYSICS_RANGE_VIOLATION",
				"alkalinity [Alk] must be >= 0 meq/L", *ws.AlkalinityMeqL,
				&domain.AllowedRange{Min: floatPtr(0.0), Unit: "meq/L"})
		}
	}
	validateWaterSpec(spec.SourceWater, "$.source_water")
	validateWaterSpec(spec.InitialSolution, "$.initial_solution")

	validateStock := func(st domain.StockTankSpec, path string) {
		registerID(st.ID, path+".id", kindStock)
		switch st.Profile {
		case "standard_part_a", "standard_part_b", "nitric_acid_0_5M", "potassium_hydroxide_0_5M", "custom":
		default:
			addIssue(st.ID, path+".profile", "INVALID_ENUM",
				"stock profile must be one of: standard_part_a, standard_part_b, nitric_acid_0_5M, potassium_hydroxide_0_5M, custom",
				st.Profile, nil)
		}
	}
	validateStock(spec.DosingStocks.StockA, "$.dosing_stocks.stock_a")
	validateStock(spec.DosingStocks.StockB, "$.dosing_stocks.stock_b")
	validateStock(spec.DosingStocks.Acid, "$.dosing_stocks.acid")
	validateStock(spec.DosingStocks.Base, "$.dosing_stocks.base")

	// Sensors validation (Module 11)
	if len(spec.Sensors) == 0 {
		addIssue("farm-root", "$.sensors", "REQUIRED_FIELD",
			"at least 1 sensor is required to observe the farm", 0,
			&domain.AllowedRange{Min: floatPtr(1), Unit: "sensors"})
	}
	for i, sen := range spec.Sensors {
		pathPrefix := fmt.Sprintf("$.sensors[%d]", i)
		registerID(sen.ID, pathPrefix+".id", kindSensor)

		targetKind, exists := compKinds[sen.AttachedToID]
		if !exists {
			addIssue(sen.ID, pathPrefix+".attached_to_id", "UNKNOWN_COMPONENT_REF",
				fmt.Sprintf("sensor %q attaches to non-existent component_id %q", sen.ID, sen.AttachedToID),
				sen.AttachedToID, nil)
		}

		switch sen.Kind {
		case "EC", "pH", "T_w", "DO", "V_res":
			if exists && targetKind != kindReservoir && targetKind != kindChannel {
				addIssue(sen.ID, pathPrefix+".attached_to_id", "INVALID_SENSOR_ATTACHMENT",
					fmt.Sprintf("aqueous sensor %q (%s) must attach to reservoir or channel, not %s", sen.ID, sen.Kind, targetKind),
					sen.AttachedToID, nil)
			}
		case "T_air", "RH", "CO2", "RGB":
			if exists && targetKind != kindEnclosure && targetKind != kindChannel {
				addIssue(sen.ID, pathPrefix+".attached_to_id", "INVALID_SENSOR_ATTACHMENT",
					fmt.Sprintf("climate/canopy sensor %q (%s) must attach to enclosure or channel, not %s", sen.ID, sen.Kind, targetKind),
					sen.AttachedToID, nil)
			}
		default:
			addIssue(sen.ID, pathPrefix+".kind", "INVALID_ENUM",
				"sensor.kind must be one of: EC, pH, T_w, DO, T_air, RH, CO2, V_res, RGB", sen.Kind, nil)
		}

		if sen.Accuracy < 0 {
			addIssue(sen.ID, pathPrefix+".accuracy", "PHYSICS_RANGE_VIOLATION",
				"sensor white-noise accuracy sigma_s must be >= 0", sen.Accuracy,
				&domain.AllowedRange{Min: floatPtr(0.0)})
		}
		if sen.DropoutProb < 0.0 || sen.DropoutProb > 1.0 {
			addIssue(sen.ID, pathPrefix+".dropout_prob", "PHYSICS_RANGE_VIOLATION",
				"sensor dropout_prob must be in [0.0, 1.0]", sen.DropoutProb,
				&domain.AllowedRange{Min: floatPtr(0.0), Max: floatPtr(1.0)})
		}
	}

	return issues
}

// ValidateFarmJSON decodes raw JSON with DisallowUnknownFields and runs all Farm validation rules.
func ValidateFarmJSON(raw []byte) (domain.FarmSpec, domain.ValidationResponse) {
	var spec domain.FarmSpec
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&spec); err != nil {
		return domain.FarmSpec{}, domain.ValidationResponse{
			Valid: false,
			Errors: []domain.ValidationIssue{
				{
					ComponentID: "farm-root",
					JSONPath:    "$",
					Code:        "INVALID_JSON_SYNTAX",
					Message:     err.Error(),
				},
			},
		}
	}
	issues := Farm(spec)
	if len(issues) == 0 {
		return spec, domain.ValidationResponse{
			Valid:  true,
			Errors: []domain.ValidationIssue{},
		}
	}
	return spec, domain.ValidationResponse{
		Valid:  false,
		Errors: issues,
	}
}
