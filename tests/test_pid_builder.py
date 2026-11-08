"""Synthetic PID GTFS fixture: no external API required by CI."""
import json
import hashlib
from datetime import date
from pathlib import Path
import tempfile
import unittest
import zipfile

from scripts.build_pid_data import (
    active_services, build, departure_bucket, physical_registry, seconds
)


class PIDBuilderTests(unittest.TestCase):
    def test_gtfs_time_over_midnight(self):
        self.assertEqual(seconds("25:10:05"), 90605)
        with self.assertRaises(ValueError):
            seconds("24:99:00")

    def test_shared_node_different_stop_groups(self):
        groups = [
            {"node": 1040, "name": "Anděl",
             "stops": [{"id": "1040/1", "gtfsIds": ["U1", "U1P"]}]},
            {"node": 1040, "name": "Na Knížecí",
             "stops": [{"id": "1040/5", "gtfsIds": ["U5"]}]}
        ]
        catalog, physical, aliases = physical_registry(
            {"stopGroups": groups}, {"U1": {}, "U1P": {}, "U5": {}}, min_count=1
        )
        self.assertEqual(len(catalog), 2)
        self.assertNotEqual(physical["1040/1"][0], physical["1040/5"][0])
        self.assertEqual(aliases["U1P"], "1040/1")

    def test_schedule_shards_and_calendar_exceptions(self):
        fixture = {
            "calendar.txt":
                "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                "A,1,1,1,1,1,1,1,20261107,20261110\n",
            "calendar_dates.txt":
                "service_id,date,exception_type\nA,20261107,2\n",
            "routes.txt":
                "route_id,route_short_name,route_long_name,route_type\n"
                "L9,9,Line 9,0\nL10,10,Line 10,0\n",
            "trips.txt":
                "route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id,trip_short_name\n"
                "L9,A,t9,Řepy,0,b9,s9,\n"
                "L10,A,t10,Řepy,0,b9,s10,\n",
            "stops.txt":
                "stop_id,stop_name,stop_lat,stop_lon,location_type,platform_code,parent_station\n"
                "U1,Anděl,50,14,0,A,\n"
                "U2,Anděl,50,14,0,B,\n",
            "stop_times.txt":
                "trip_id,arrival_time,departure_time,stop_id,stop_sequence,trip_operation_type\n"
                "t9,24:05:00,24:05:00,U1,1,1\n"
                "t9,24:10:00,24:10:00,U2,2,1\n"
                "t10,24:20:00,24:20:00,U2,1,1\n",
            "shapes.txt":
                "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
                "s9,50,14,1\ns9,50.1,14.1,2\ns10,50,14,1\n"
        }
        registry = {
            "generatedAt": "2026-11-08T04:11:59",
            "stopGroups": [
                {"node": 1040, "name": "Anděl",
                 "stops": [{"id": "1040/1", "gtfsIds": ["U1"]},
                           {"id": "1040/2", "gtfsIds": ["U2"]}]}
            ]
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            feed = root / "test-gtfs.zip"
            with zipfile.ZipFile(feed, "w") as output:
                for name, content in fixture.items():
                    output.writestr(name, content)
            with zipfile.ZipFile(feed) as zf:
                selected = active_services(
                    zf, [date(2026, 11, 7), date(2026, 11, 8)]
                )
                self.assertNotIn("A", selected["2026-11-07"])
                manifest = build(
                    zf, registry, root / "data", date(2026, 11, 8),
                    min_count=1
                )
            self.assertEqual(manifest["checksumsFile"], "checksums.json")
            self.assertNotIn("checksums", manifest)
            self.assertLess((root / "data/manifest.json").stat().st_size, 8192)
            raw_index = (root / "data/checksums.json").read_bytes()
            self.assertEqual(
                hashlib.sha256(raw_index).hexdigest(), manifest["checksumsSha256"]
            )
            index = json.loads(raw_index)
            self.assertEqual(len(index), manifest["checksumsCount"])
            self.assertEqual(
                index["stops/gtfs-map.json"],
                hashlib.sha256((root / "data/stops/gtfs-map.json").read_bytes()).hexdigest()
            )
            self.assertFalse(manifest["days"]["2026-11-07"]["available"])
            self.assertEqual(manifest["days"]["2026-11-08"]["trips"], 2)
            self.assertIn("platformEncounterTrips", manifest["days"]["2026-11-08"])
            day = root / "data/days/2026-11-08"
            encounters = json.loads((day / "platform-encounters.json").read_text())
            self.assertEqual(len(encounters), manifest["days"]["2026-11-08"]["platformEncounterTrips"])
            blocks = json.loads((day / "blocks.json").read_text())
            self.assertEqual([entry[1] for entry in blocks["b9"]], ["t9", "t10"])
            bucket = departure_bucket("U1")
            departures = json.loads(
                (day / "departures" / (bucket + ".json")).read_text()
            )
            self.assertEqual(departures["U1"][0][0], 86700)
            stop_map = json.loads(
                (root / "data/stops/gtfs-map.json").read_text()
            )
            self.assertEqual(stop_map["U1"], "1040/1")
            shapes = list((root / "data/shapes").glob("*.json"))
            self.assertEqual(len(shapes), 2)


if __name__ == "__main__":
    unittest.main()
