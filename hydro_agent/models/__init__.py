"""Digital Twin physics-informed simulation and control models package."""

from .model1_microclimate import (
    CoupledStates,
    EnclosureStates,
    FacilityParameters,
    MicroclimateThermalEngine,
    Model1Input,
    Model1Output,
    OutdoorWeather,
    RootZoneStates,
)
from .model2_oxygen import (
    ChannelGeometryInputs,
    DissolvedOxygenHydraulicsObserver,
    DissolvedOxygenOutput,
    HydraulicsOutput,
    Model2Input,
    Model2Output,
    OperationalStateInputs,
    OxygenHydraulicsParams,
    TemperatureInputs,
    WaterPropertyInputs,
)
from .model3_chemistry import (
    BulkChemicalProperties,
    DosingActions,
    MakeupWater,
    Model3Input,
    Model3Output,
    SolutionChemistrySolver,
)
from .model4_crop import (
    BiomassYieldOutput,
    CropBiomassEngine,
    CropMicroclimate,
    CropParameters,
    Model4Input,
    Model4Output,
    RootZoneContext,
    TranspirationOutput,
)
from .model5_diagnostics import (
    ActuatorContext,
    DiagnosticAlert,
    FaultResidualAnomalyDetector,
    Model5HealthMatrix,
    Model5Input,
    TelemetryPoint,
    TwinReferenceStates,
)
from .model6_controller import (
    ActuationCommand,
    AgronomicTargets,
    ChemicalContext,
    CurrentTelemetry,
    FertigationSafetyController,
    Model6Input,
)

__all__ = [
    # Model 1
    "Model1Input",
    "Model1Output",
    "OutdoorWeather",
    "FacilityParameters",
    "CoupledStates",
    "EnclosureStates",
    "RootZoneStates",
    "MicroclimateThermalEngine",
    # Model 2
    "Model2Input",
    "Model2Output",
    "TemperatureInputs",
    "WaterPropertyInputs",
    "ChannelGeometryInputs",
    "OperationalStateInputs",
    "DissolvedOxygenOutput",
    "HydraulicsOutput",
    "OxygenHydraulicsParams",
    "DissolvedOxygenHydraulicsObserver",
    # Model 3
    "Model3Input",
    "Model3Output",
    "MakeupWater",
    "DosingActions",
    "BulkChemicalProperties",
    "SolutionChemistrySolver",
    # Model 4
    "Model4Input",
    "Model4Output",
    "CropMicroclimate",
    "RootZoneContext",
    "CropParameters",
    "TranspirationOutput",
    "BiomassYieldOutput",
    "CropBiomassEngine",
    # Model 5
    "Model5Input",
    "Model5HealthMatrix",
    "TelemetryPoint",
    "TwinReferenceStates",
    "ActuatorContext",
    "DiagnosticAlert",
    "FaultResidualAnomalyDetector",
    # Model 6
    "Model6Input",
    "ActuationCommand",
    "CurrentTelemetry",
    "AgronomicTargets",
    "ChemicalContext",
    "FertigationSafetyController",
]

