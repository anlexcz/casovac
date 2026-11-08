"""Line-set differences are the primary, deterministic 5B junction signal."""
import unittest
from scripts.build_connection_index import platform_encounters

def classify(previous="B",same_line=False,other_platform="P",shapes=None,stops=None,
             include_other=True, other_arrival=2000):
    lines = {"R3": ["3","","0"], "R17": ["17","","0"], "R21": ["3" if same_line else "21","","0"]}
    day={"R3":["a"],"R17":["b"]}
    if include_other:day["R21"]=["c"]
    timetable = {
        "a":[["A",100,100,1],["P3",200,200,2],["X",300,300,3]],
        "b":[["A",105,105,1],["P17",205,205,2],["Y",305,305,3]],
        "c":[[previous,100,100,1],["P21",other_arrival,other_arrival,2],["Z",3000,3000,3]]
    }
    meta = {trip:[route,"","","","",{"a":"s3","b":"s17","c":"s21"}[trip],""] for route,tid in day.items() for trip in tid}
    return platform_encounters(day,timetable,meta,lines,
      {"A":"A","B":"B","P3":"P","P17":"P","P21":other_platform,
       "X":"X","Y":"Y","Z":"Z"},
      geometry=shapes or {},gtfs_stops=stops or {})

class LineSetTests(unittest.TestCase):
    def test_new_route_is_detected_even_without_a_nearby_trip(self):
        data=classify()
        self.assertIn([2,"P","tram-route-set",[]],data["a"])
        self.assertIn([2,"P","tram-route-set",[]],data["c"])
    def test_same_incoming_platform_is_not_a_junction(self):
        data=classify(previous="A")
        self.assertIn([2,"P","shared-platform",[]],data["a"])
        self.assertNotIn([2,"P","tram-route-set",[]],data["a"])
    def test_optional_all_mode_can_include_still_shared_tram_platform(self):
        data=classify(include_other=False)
        self.assertIn([2,"P","shared-platform",[]],data["a"])
    def test_different_gtfs_ids_cannot_expand_across_physical_edges(self):
        data=classify(other_platform="SIDE")
        self.assertIn([2,"P","shared-platform",[]],data["a"])
        self.assertNotIn([2,"P","tram-route-set",[]],data["a"])
    def test_same_number_different_branch_is_ambiguous_without_shapes(self):
        data=classify(same_line=True, other_arrival=205)
        self.assertNotIn([2,"P","tram-route-set",[]],data["a"])
        self.assertIn([2,"P","tram-branch-candidate",["c"]],data["a"])
    def test_shapes_confirming_shared_track_veto_the_route_set_change(self):
        # Different preceding stops A/B are on the same physical approach.
        shapes={
            "s3":[[1,50,13.997],[2,50,13.998],[3,50,13.999],[4,50,14],[5,50.001,14]],
            "s17":[[1,50,13.997],[2,50,13.998],[3,50,13.999],[4,50,14],[5,50.001,14]],
            "s21":[[1,50,13.997],[2,50,13.998],[3,50,13.999],[4,50,14],[5,50.001,14]]
        }
        stops={key:{"a":50,"o":lon} for key,lon in [
           ("A",13.997),("B",13.998),("P3",14),("P17",14),("P21",14)]}
        data=classify(shapes=shapes,stops=stops)
        self.assertNotIn([2,"P","tram-route-set",[]],data["a"])
    def test_outgoing_split_does_not_prevent_incoming_merge(self):
        data=classify()
        self.assertIn([2,"P","tram-route-set",[]],data["a"])
    def test_only_active_routes_are_counted(self):
        data=classify(include_other=False)
        self.assertNotIn([2,"P","tram-route-set",[]],data["a"])

if __name__=="__main__":
    unittest.main()
