"""Test actual incoming-shape evidence, not just different preceding stop names."""
import unittest

from scripts.branch_geometry import incoming_points, different_incoming_branches
from scripts.build_connection_index import platform_encounters

TARGET = (50.0, 14.0)
WEST = (50.0, 13.997)
SOUTH = (49.997, 14.0)
EAST = (50.0, 14.003)

SHAPES = {
    "west": [[1, *WEST], [2, 50.0, 13.999], [3, *TARGET], [4, 50.001, 14.0]],
    "south": [[1, *SOUTH], [2, 49.999, 14.0], [3, *TARGET], [4, 50.001, 14.0]],
    "same": [[1, *WEST], [2, 50.0, 13.999], [3, *TARGET], [4, 50.001, 14.0]],
    "parallel": [[1, 50.00002, 13.997], [2, 50.00002, 13.999],
                 [3, 50.00002, 14.0], [4, 50.001, 14.0]],
}
STOPS = {
    "A": {"a": WEST[0], "o": WEST[1]},
    "B": {"a": SOUTH[0], "o": SOUTH[1]},
    "C": {"a": EAST[0], "o": EAST[1]},
    "P": {"a": TARGET[0], "o": TARGET[1]},
    "P2": {"a": TARGET[0], "o": TARGET[1]},
}


def build(shape_second="south", previous_second="B", physical_second="platform"):
    times = {
        "own": [["A", 100, 100, 1], ["P", 200, 200, 2]],
        "other": [[previous_second, 110, 110, 1], ["P2", 1300, 1300, 2]],
    }
    metadata = {
        "own": ["T", "", "", "", "", "west", ""],
        "other": ["T", "", "", "", "", shape_second, ""],
    }
    mapping = {"P": "platform", "P2": physical_second,
               "A": "west-branch", "B": "south-branch", "C": "east-branch"}
    return platform_encounters(
        {"T": ["own", "other"]}, times, metadata,
        {"T": ["9", "", "0"]}, mapping,
        geometry=SHAPES, gtfs_stops=STOPS
    )


class IncomingShapeTests(unittest.TestCase):
    def test_true_converging_tracks_confirms_without_simultaneous_departure(self):
        data = build()
        self.assertEqual(data["own"],
                         [[2, "platform", "tram-branch-confirmed", []]])
        self.assertEqual(data["other"],
                         [[2, "platform", "tram-branch-confirmed", []]])

    def test_same_track_from_differently_named_previous_stop_cannot_confirm(self):
        data = build("same")
        self.assertNotIn("own", data)

    def test_parallel_lines_do_not_trigger_even_if_both_use_platform(self):
        data = build("parallel")
        self.assertNotIn("own", data)

    def test_unrelated_physical_platform_never_triggers(self):
        data = build(physical_second="other-platform")
        self.assertNotIn("own", data)

    def test_missing_geometry_only_yields_candidate_for_near_timed_service(self):
        data = build("missing")
        self.assertNotIn("own", data)

    def test_wrong_shape_order_cannot_trigger(self):
        reversed_shape = [list(row) for row in reversed(SHAPES["south"])]
        previous = SHAPES["south"]
        try:
            SHAPES["south"] = [[i, p[1], p[2]] for i, p in enumerate(reversed_shape)]
            self.assertNotIn("own", build())
        finally:
            SHAPES["south"] = previous

    def test_several_adjacent_shape_segments_near_one_stop_are_one_visit(self):
        shape = [[50.0, 13.997], [50.0, 13.9985],
                 [50.00004, 13.999], [50.0, 13.9995], [50.0, 14.0]]
        self.assertIsNotNone(incoming_points(shape, WEST, TARGET))

    def test_ambiguous_repeated_passage_rejected(self):
        loop = [[p[1],p[2]] for p in SHAPES["west"][:3]]
        self.assertIsNone(incoming_points(loop+loop, WEST, TARGET))

    def test_short_or_absent_approach_rejected(self):
        self.assertIsNone(incoming_points([[50.0, 13.9999], [50.0, 14.0]],
                                          (50.0, 13.9999), TARGET))
        self.assertFalse(different_incoming_branches(None, None))


if __name__ == "__main__":
    unittest.main()
