"""Synthetic phase 5B tests: never infer platform equality from names/GPS."""
import unittest
from scripts.build_connection_index import platform_encounters


class PlatformEncounterTests(unittest.TestCase):
    def setUp(self):
        self.routes = {"T": ["9", "", "0"], "B": ["140", "", "3"],
                       "TB": ["58", "", "11"], "R": ["R", "", "2"]}
        self.stop_map = {"P-T": "physical-1", "P-B": "physical-1",
                         "P-TB": "physical-1", "P-R": "physical-1",
                         "OTHER": "physical-2", "A": "approach-a",
                         "B": "approach-b"}
        self.trips = {"tram": [["A", 100, 100, 1], ["P-T", 200, 210, 2]],
                      "bus": [["B", 90, 90, 1], ["P-B", 240, 240, 2]],
                      "trolley": [["B", 100, 100, 1], ["P-TB", 210, 210, 2]],
                      "wrong": [["B", 100, 100, 1], ["OTHER", 201, 201, 2]],
                      "rail": [["A", 100, 100, 1], ["P-R", 205, 205, 2]]}

    def build(self, day=None):
        return platform_encounters(day or {"T": ["tram"], "B": ["bus"],
                                          "TB": ["trolley"], "R": ["rail"]},
                                   self.trips, {}, self.routes, self.stop_map)

    def test_bus_and_trolley_exact_physical_edge(self):
        rows = self.build()["tram"]
        self.assertEqual(rows, [[2, "physical-1", "mixed-platform", []],
                                [2, "physical-1", "mixed-confirmed", ["bus", "trolley"]]])

    def test_different_physical_edge_never_matches(self):
        rows = self.build({"T": ["tram"], "B": ["wrong"]})
        self.assertNotIn("tram", rows)

    def test_unrelated_train_does_not_match(self):
        rows = self.build({"T": ["tram"], "R": ["rail"]})
        self.assertNotIn("tram", rows)

    def test_outside_time_window_does_not_match(self):
        self.trips["bus"][1][1] = 321
        rows = self.build({"T": ["tram"], "B": ["bus"]})
        self.assertEqual(rows["tram"], [[2, "physical-1", "mixed-platform", []]])

    def test_different_approach_is_only_candidate(self):
        self.trips["other_tram"] = [["B", 100, 100, 1], ["P-B", 205, 205, 2]]
        rows = self.build({"T": ["tram", "other_tram"]})["tram"]
        self.assertEqual(rows, [[2, "physical-1", "tram-branch-candidate", ["other_tram"]]])

    def test_same_approach_is_not_an_auto_trigger(self):
        self.trips["other_tram"] = [["A", 100, 100, 1], ["P-B", 205, 205, 2]]
        rows = self.build({"T": ["tram", "other_tram"]})
        self.assertNotIn("tram", rows)

    def test_repeated_platform_preserves_stop_sequence(self):
        self.trips["tram"].append(["P-T", 400, 400, 3])
        self.trips["bus"].append(["P-B", 401, 401, 3])
        rows = self.build({"T": ["tram"], "B": ["bus"]})["tram"]
        self.assertEqual([row[0] for row in rows], [2, 2, 3, 3])


if __name__ == "__main__":
    unittest.main()
