"""Unit and physical tests for Model 4: Transpiration & Crop Growth Engine."""

import unittest

from hydro_agent.models.model4_crop import (
    BiomassYieldOutput,
    CropBiomassEngine,
    CropMicroclimate,
    CropParameters,
    Model4Input,
    Model4Output,
    RootZoneContext,
    TranspirationOutput,
)


class TestModel4Crop(unittest.TestCase):
    """Test suite for Model 4 crop physiology engine."""

    def setUp(self):
        self.engine = CropBiomassEngine()

    def test_stanghellini_transpiration(self):
        """Verify canopy transpiration and stomatal resistance response."""
        micro = CropMicroclimate(
            par_irradiance_w_m2=320.0,
            air_temperature_c=24.35,
            vpd_kpa=1.15,
        )
        e_can, r_i, t_leaf = self.engine.compute_transpiration(micro, lai=1.85)

        # Transpiration should be strictly positive during daytime
        self.assertGreater(e_can, 0.0)
        self.assertLess(e_can, 0.001)
        self.assertGreater(r_i, 85.0)  # Greater than r_min
        self.assertAlmostEqual(t_leaf, 24.0, delta=3.0)

    def test_multi_stress_modifier(self):
        """Verify that hypoxia and extreme EC reduce stress factor."""
        healthy_root = RootZoneContext(channel_outlet_do_mg_l=7.5, ec25_ds_m=2.0, ph=6.0)
        hypoxic_root = RootZoneContext(channel_outlet_do_mg_l=1.2, ec25_ds_m=2.0, ph=6.0)

        phi_healthy = self.engine.compute_stress_modifier(healthy_root)
        phi_hypoxic = self.engine.compute_stress_modifier(hypoxic_root)

        self.assertGreater(phi_healthy, 0.75)
        self.assertLess(phi_hypoxic, phi_healthy)

    def test_end_to_end_simulate(self):
        """Verify Van Henten growth step and Andriolo fresh weight yield."""
        inputs = Model4Input(
            microclimate=CropMicroclimate(par_irradiance_w_m2=320.0),
            root_zone=RootZoneContext(channel_outlet_do_mg_l=7.42, ec25_ds_m=2.015),
            crop_parameters=CropParameters(plant_density_pl_m2=24.0),
        )
        out = self.engine.simulate(inputs, dt_sec=300.0)

        self.assertIsInstance(out, Model4Output)
        self.assertGreater(out.biomass_and_yield.shoot_fresh_weight_g_plant, 50.0)
        self.assertGreater(out.biomass_and_yield.effective_lai, 0.5)
        self.assertIn("NO3", out.root_uptake_fluxes_mol_plant_s)


if __name__ == "__main__":
    unittest.main()
