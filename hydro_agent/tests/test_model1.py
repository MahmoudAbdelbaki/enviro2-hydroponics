"""Unit and physical tests for Model 1: Microclimate & Thermal-Vapor Engine."""

import unittest

from hydro_agent.models.model1_microclimate import (
    CoupledStates,
    EnclosureStates,
    FacilityParameters,
    MicroclimateThermalEngine,
    Model1Input,
    Model1Output,
    OutdoorWeather,
    RootZoneStates,
)


class TestModel1Microclimate(unittest.TestCase):
    """Test suite for Model 1 physics engine."""

    def setUp(self):
        self.engine = MicroclimateThermalEngine()

    def test_psychrometrics_magnus_tetens(self):
        """Verify saturation vapor pressure and VPD computation."""
        # At 20 °C, e* ≈ 2338 Pa
        e_sat_20 = self.engine.sat_vapor_pressure_pa(20.0)
        self.assertAlmostEqual(e_sat_20, 2338.0, delta=15.0)

        # RH and VPD check at 25 °C with 0.015 kg/m^3 vapor density
        rh, vpd = self.engine.compute_vpd_kpa(25.0, 0.015)
        self.assertGreater(rh, 40.0)
        self.assertLess(rh, 80.0)
        self.assertGreater(vpd, 0.5)

    def test_channel_ntu_heat_exchanger(self):
        """Verify algebraic NTU solver for gully water temperature."""
        t_air = 25.0
        t_res = 20.0
        solar = 500.0
        lai = 2.0
        pump_flow = 0.00005
        area = 10.8

        t_out, t_mean = self.engine.solve_channel_temperature(
            t_air_c=t_air,
            t_res_c=t_res,
            solar_canopy_w_m2=solar,
            lai=lai,
            pump_flow_m3_s=pump_flow,
            channel_area_m2=area,
        )

        # Solar absorption and warmer air must warm the nutrient film
        self.assertGreater(t_out, t_res)
        self.assertGreater(t_mean, t_res)
        self.assertLessEqual(t_mean, t_out)

    def test_step_simulation_schema(self):
        """Verify dynamic forward integration and output schema."""
        inputs = Model1Input(
            sim_time_sec=86400.0,
            delta_t_sec=300.0,
            outdoor_weather=OutdoorWeather(shortwave_irradiance_w_m2=650.0, air_temperature_c=28.5),
        )
        out = self.engine.step(inputs)

        self.assertIsInstance(out, Model1Output)
        self.assertEqual(out.sim_time_sec, 86700.0)
        self.assertGreater(out.enclosure_states.t_air_c, 15.0)
        self.assertLess(out.enclosure_states.t_air_c, 40.0)
        self.assertGreater(out.root_zone_states.t_res_c, 15.0)


if __name__ == "__main__":
    unittest.main()
