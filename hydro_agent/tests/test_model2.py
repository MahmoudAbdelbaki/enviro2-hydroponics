"""Comprehensive physical and unit tests for Model 2 Dissolved Oxygen & Hydraulics Observer.

Validates:
1. USGS DOTABLES / BK84 benchmark dissolved oxygen saturation reproduction (0 °C, 20 °C, 40 °C).
2. Salinity (EC25) and barometric elevation pressure scaling.
3. Manning hydraulics with clean channel vs root-mat drag resistance and zero-flow puddle state.
4. Chun-Takakura specific root respiration kinetics (Q10 scaling and Michaelis-Menten saturation).
5. 1D longitudinal plug-flow transport, surface reaeration, and 3-point Simpson quadrature.
6. End-to-end schema serialization matching model_2_dissolved_oxygen_channel_hydraulics_soft_sensor.md.
"""

import math
import unittest

from hydro_agent.models.model2_oxygen import (
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


class TestDissolvedOxygenHydraulicsObserver(unittest.TestCase):
    """Test suite for first-principles Model 2 observer."""

    def setUp(self):
        self.params = OxygenHydraulicsParams()
        self.observer = DissolvedOxygenHydraulicsObserver(self.params)

    # --------------------------------------------------------------------------
    # 1. Benson & Krause (1984) / USGS DOTABLES DO Saturation
    # --------------------------------------------------------------------------

    def test_benson_krause_usgs_benchmarks(self):
        """Reproduce published literature benchmarks in PHYSICS_SPEC.md Table 15.4."""
        # Pure water, 1 atm pressure
        c_0c = self.observer.compute_benson_krause_sat(temp_c=0.0, ec25_ds_m=0.0, elevation_m=0.0)
        c_20c = self.observer.compute_benson_krause_sat(temp_c=20.0, ec25_ds_m=0.0, elevation_m=0.0)
        c_40c = self.observer.compute_benson_krause_sat(temp_c=40.0, ec25_ds_m=0.0, elevation_m=0.0)

        # Published Table 15.4: 0°C -> 14.6208, 20°C -> 9.0924, 40°C -> 6.4127
        self.assertAlmostEqual(c_0c, 14.6208, places=3)
        self.assertAlmostEqual(c_20c, 9.0924, places=3)
        self.assertAlmostEqual(c_40c, 6.4127, places=3)

    def test_benson_krause_salinity_depression(self):
        """Verify practical salinity (from EC) reduces oxygen saturation (salting-out effect)."""
        c_fresh = self.observer.compute_benson_krause_sat(temp_c=20.0, ec25_ds_m=0.0)
        c_saline = self.observer.compute_benson_krause_sat(temp_c=20.0, ec25_ds_m=2.0)

        # Salinity S = 0.55 * 2.0 = 1.1 g/kg
        self.assertLess(c_saline, c_fresh)
        self.assertAlmostEqual(c_saline, 9.034, places=2)

    def test_benson_krause_elevation_pressure_correction(self):
        """Verify altitude barometric lapse reduces saturation oxygen."""
        c_sea_level = self.observer.compute_benson_krause_sat(temp_c=20.0, elevation_m=0.0)
        c_elevated = self.observer.compute_benson_krause_sat(temp_c=20.0, elevation_m=500.0)

        self.assertLess(c_elevated, c_sea_level)

    def test_benson_krause_invalid_temperature(self):
        """Water temperature below absolute zero must raise ValueError."""
        with self.assertRaises(ValueError):
            self.observer.compute_benson_krause_sat(temp_c=-274.0)

    # --------------------------------------------------------------------------
    # 2. Manning Hydraulics & Root-Mat Drag Multiplier
    # --------------------------------------------------------------------------

    def test_manning_hydraulics_clean_vs_root_drag(self):
        """Verify root dry mass increases effective roughness and film depth."""
        # Clean channel
        hyd_clean = self.observer.solve_channel_hydraulics(
            pump_flow_rate_m3_s=0.00005,
            num_channels=6,
            channel_length_m=12.0,
            channel_width_m=0.15,
            bed_slope_m_m=0.02,
            root_dry_mass_kg_plant=0.0,
            plant_spacing_m=0.20,
        )

        # Dense mature root system
        hyd_roots = self.observer.solve_channel_hydraulics(
            pump_flow_rate_m3_s=0.00005,
            num_channels=6,
            channel_length_m=12.0,
            channel_width_m=0.15,
            bed_slope_m_m=0.02,
            root_dry_mass_kg_plant=0.0055,
            plant_spacing_m=0.20,
        )

        # Effective roughness n_eff should be larger with roots
        self.assertEqual(hyd_clean["effective_manning_n"], self.params.n_pvc)
        self.assertGreater(hyd_roots["effective_manning_n"], hyd_clean["effective_manning_n"])

        # Film depth should be greater with roots
        self.assertGreater(hyd_roots["film_depth_mm"], hyd_clean["film_depth_mm"])

        # Channel volume and residence time should increase with roots
        self.assertGreater(hyd_roots["total_channel_volume_l"], hyd_clean["total_channel_volume_l"])
        self.assertGreater(hyd_roots["residence_time_sec"], hyd_clean["residence_time_sec"])

        # Film depth, volume, and residence time physical bounds
        self.assertAlmostEqual(hyd_roots["film_depth_mm"], 1.08, places=2)
        self.assertAlmostEqual(hyd_roots["total_channel_volume_l"], 11.71, places=2)
        self.assertAlmostEqual(hyd_roots["residence_time_sec"], 234.2, places=1)

    def test_manning_hydraulics_zero_flow_puddle(self):
        """When pump stalls (Q = 0), water drains to residual puddle depth (0.5 mm)."""
        hyd_stalled = self.observer.solve_channel_hydraulics(
            pump_flow_rate_m3_s=0.0,
            num_channels=6,
            channel_length_m=12.0,
            channel_width_m=0.15,
            bed_slope_m_m=0.02,
            root_dry_mass_kg_plant=0.0055,
            plant_spacing_m=0.20,
        )

        self.assertAlmostEqual(hyd_stalled["film_depth_m"], self.params.h_res_puddle, places=5)
        self.assertEqual(hyd_stalled["flow_velocity_m_s"], 0.0)
        self.assertTrue(math.isinf(hyd_stalled["residence_time_sec"]))

    # --------------------------------------------------------------------------
    # 3. Chun-Takakura Specific Root Oxygen Respiration
    # --------------------------------------------------------------------------

    def test_chun_takakura_respiration_kinetics(self):
        """Verify Q10 thermal scaling and Michaelis-Menten half-saturation."""
        x_rt = 0.0055  # 5.5 g DM per plant

        # Respiration at 23 °C and saturated DO (>> Km)
        r_23c_sat = self.observer.compute_root_respiration(
            temp_c=23.0, root_dry_mass_kg_plant=x_rt, do_concentration_mg_l=100.0
        )
        # Expected: r_o2_ref * x_rt * (100 / 101.5)
        expected_sat = self.params.r_o2_ref * x_rt * (100.0 / (self.params.km_do + 100.0))
        self.assertAlmostEqual(r_23c_sat, expected_sat, places=7)

        # Thermal scaling test: 33 °C vs 23 °C should double (Q10 = 2.0)
        r_33c_sat = self.observer.compute_root_respiration(
            temp_c=33.0, root_dry_mass_kg_plant=x_rt, do_concentration_mg_l=100.0
        )
        self.assertAlmostEqual(r_33c_sat / r_23c_sat, 2.0, places=3)

        # Half-saturation test: at C_DO = Km (1.50 mg/L), uptake must be exactly 50% of Vmax
        r_half = self.observer.compute_root_respiration(
            temp_c=23.0, root_dry_mass_kg_plant=x_rt, do_concentration_mg_l=self.params.km_do
        )
        vmax_23c = self.params.r_o2_ref * x_rt
        self.assertAlmostEqual(r_half / vmax_23c, 0.5, places=5)

    def test_respiration_zero_do_safety(self):
        """Zero DO must yield zero respiration, avoiding negative unphysical states."""
        r_zero = self.observer.compute_root_respiration(
            temp_c=23.0, root_dry_mass_kg_plant=0.0055, do_concentration_mg_l=0.0
        )
        self.assertEqual(r_zero, 0.0)

    # --------------------------------------------------------------------------
    # 4. 1D Longitudinal Plug-Flow Transport & Reaeration
    # --------------------------------------------------------------------------

    def test_longitudinal_profile_decay(self):
        """Channel outlet DO must decline along the channel under active root uptake."""
        c_in = 8.15
        c_sat = 8.68
        q_ch = 0.00005 / 6.0
        w_ch = 0.15
        l_ch = 12.0
        kv = 2.08e-5

        c_out, c_mean, r_plant_mg_hr = self.observer.solve_longitudinal_profile(
            c_in_mg_l=c_in,
            c_sat_mg_l=c_sat,
            q_ch_m3_s=q_ch,
            channel_width_m=w_ch,
            channel_length_m=l_ch,
            kv_m_s=kv,
            plants_per_channel=12,
            root_dry_mass_kg_plant=0.0055,
            temp_c=22.40,
        )

        # Outlet DO must be less than inlet DO due to respiration
        self.assertLess(c_out, c_in)
        # Mean DO must be bounded between outlet and inlet
        self.assertLess(c_out, c_mean)
        self.assertLess(c_mean, c_in)
        # Specific root consumption in mg/hr/plant
        self.assertGreater(r_plant_mg_hr, 10.0)
        self.assertLess(r_plant_mg_hr, 16.0)

    def test_reaeration_without_roots(self):
        """If root dry mass is zero, DO relaxes toward C_sat via free-surface reaeration."""
        c_in = 6.0
        c_sat = 9.0
        q_ch = 0.00005 / 6.0
        kv = 2.2e-5

        c_out, c_mean, _ = self.observer.solve_longitudinal_profile(
            c_in_mg_l=c_in,
            c_sat_mg_l=c_sat,
            q_ch_m3_s=q_ch,
            channel_width_m=0.15,
            channel_length_m=12.0,
            kv_m_s=kv,
            plants_per_channel=12,
            root_dry_mass_kg_plant=0.0,
            temp_c=20.0,
        )

        # Water must absorb oxygen, increasing DO toward saturation
        self.assertGreater(c_out, c_in)
        self.assertLessEqual(c_out, c_sat)

    def test_hypoxic_simpson_quadrature(self):
        """Non-linear 3-point Simpson quadrature triggers under severe oxygen depletion."""
        # Low inlet DO near Km
        c_in = 1.8
        c_sat = 8.0
        q_ch = 0.00005 / 6.0
        kv = 1.0e-5

        c_out, c_mean, r_mid = self.observer.solve_longitudinal_profile(
            c_in_mg_l=c_in,
            c_sat_mg_l=c_sat,
            q_ch_m3_s=q_ch,
            channel_width_m=0.15,
            channel_length_m=12.0,
            kv_m_s=kv,
            plants_per_channel=24,  # High plant density
            root_dry_mass_kg_plant=0.015,  # Heavy root mat
            temp_c=25.0,
        )

        self.assertGreaterEqual(c_out, 0.0)
        self.assertGreaterEqual(c_mean, 0.0)

    # --------------------------------------------------------------------------
    # 5. End-to-End Observe Pipeline & Schema Validation
    # --------------------------------------------------------------------------

    def test_end_to_end_observer_with_spec_payload(self):
        """Validate observe() with the exact payload from the digital twin ML handbook."""
        input_dict = {
            "temperatures": {
                "t_res_c": 21.85,
                "t_ch_c": 22.40,
            },
            "water_properties": {
                "ec25_ds_m": 2.02,
                "elevation_m": 7.0,
            },
            "channel_geometry": {
                "num_channels": 6,
                "channel_length_m": 12.0,
                "channel_width_m": 0.15,
                "bed_slope_m_m": 0.02,
                "plants_per_channel": 12,
                "plant_spacing_m": 0.20,
            },
            "operational_states": {
                "pump_flow_rate_m3_s": 0.00005,
                "reservoir_do_mg_l": 8.15,
                "root_dry_mass_kg_plant": 0.0055,
            },
        }

        # 1. From dict instantiation
        model_input = Model2Input.from_dict(input_dict)
        self.assertEqual(model_input.temperatures.t_ch_c, 22.40)
        self.assertEqual(model_input.operational_states.pump_flow_rate_m3_s, 0.00005)

        # 2. Run observer
        output: Model2Output = self.observer.observe(model_input)

        # 3. Validate types and bounds
        self.assertIsInstance(output, Model2Output)
        self.assertIsInstance(output.dissolved_oxygen, DissolvedOxygenOutput)
        self.assertIsInstance(output.hydraulics, HydraulicsOutput)

        # 4. Check specific schema predictions
        do = output.dissolved_oxygen
        hyd = output.hydraulics

        # DO saturation: BK84 at 22.40 °C, EC 2.02, z 7.0 m
        self.assertAlmostEqual(do.saturation_concentration_mg_l, 8.61, places=2)
        # Outlet DO and mean DO within physical range
        self.assertGreater(do.channel_outlet_do_mg_l, 6.0)
        self.assertLess(do.channel_outlet_do_mg_l, 8.61)
        self.assertAlmostEqual(do.channel_mean_do_mg_l, 8.19, places=2)
        self.assertAlmostEqual(do.channel_outlet_do_mg_l, 8.20, places=2)
        # Respiration rate per plant
        self.assertAlmostEqual(do.specific_root_consumption_mg_hr_plant, 12.5, places=1)

        # Hydraulics check
        self.assertAlmostEqual(hyd.film_depth_mm, 1.08, places=2)
        self.assertAlmostEqual(hyd.total_channel_volume_l, 11.71, places=2)
        self.assertAlmostEqual(hyd.residence_time_sec, 234.2, places=1)
        self.assertGreater(hyd.flow_velocity_m_s, 0.0)

        # 5. To dict round-trip
        out_dict = output.to_dict()
        self.assertIn("dissolved_oxygen", out_dict)
        self.assertIn("hydraulics", out_dict)
        rehydrated = Model2Output.from_dict(out_dict)
        self.assertAlmostEqual(rehydrated.dissolved_oxygen.saturation_concentration_mg_l, 8.61, places=2)


if __name__ == "__main__":
    unittest.main()
