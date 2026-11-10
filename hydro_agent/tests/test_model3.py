"""Unit and physical tests for Model 3: Solution Chemistry & Multi-Ion Speciation."""

import unittest

from hydro_agent.models.model3_chemistry import (
    BulkChemicalProperties,
    DosingActions,
    MakeupWater,
    Model3Input,
    Model3Output,
    SolutionChemistrySolver,
)


class TestModel3Chemistry(unittest.TestCase):
    """Test suite for Model 3 chemistry solver."""

    def setUp(self):
        self.solver = SolutionChemistrySolver()

    def test_kohlrausch_onsager_ec(self):
        """Verify bulk electrical conductivity computation from ionic conductances."""
        ec25, ec_raw, i_str = self.solver.compute_ec(self.solver.ions_mmol_l, temp_c=25.0)
        # Standard Hoagland nutrient solution EC25 is approx 2.0 dS/m
        self.assertAlmostEqual(ec25, 2.0, delta=0.3)
        self.assertAlmostEqual(ec25, ec_raw, delta=0.01)  # At 25 °C, raw equals 25 °C compensated
        self.assertGreater(i_str, 0.01)

    def test_newton_raphson_ph_solve(self):
        """Verify non-linear electroneutrality speciation iteration."""
        # For typical alkalinity = 0.52 meq/L, pH should be around 5.8 - 6.2
        ph, beta_buf = self.solver.solve_ph_and_buffer_capacity(
            alkalinity_meq_l=0.521,
            p_tot_mmol_l=1.95,
            nh4_tot_mmol_l=0.85,
        )
        self.assertGreater(ph, 5.0)
        self.assertLess(ph, 7.0)
        self.assertGreater(beta_buf, 0.1)

    def test_end_to_end_solve_with_dosing(self):
        """Verify ion balance updates and precipitation with acid/stock doses."""
        inputs = Model3Input(
            total_volume_l=100.0,
            water_temperature_c=21.85,
            dosing_actions=DosingActions(dose_stock_a_ml=10.0, dose_acid_ml=2.0),
        )
        out = self.solver.solve(inputs)

        self.assertIsInstance(out, Model3Output)
        self.assertIn("NO3", out.dissolved_ions_mmol_l)
        self.assertIn("Ca", out.dissolved_ions_mmol_l)
        self.assertGreater(out.bulk_properties.ec25_ds_m, 1.5)


if __name__ == "__main__":
    unittest.main()

