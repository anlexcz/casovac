#!/usr/bin/env python3
"""Check the actual daily 5B PID bundle, including verified tram junctions."""
import argparse
from collections import Counter
import json
from pathlib import Path

KINDS = {
    "mixed-platform", "mixed-confirmed",
    "tram-branch-candidate", "tram-branch-confirmed", "tram-route-set"
}


def audit(root: Path) -> dict:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    groups = json.loads((root / "stops/groups.json").read_text(encoding="utf-8"))
    platforms = json.loads((root / "stops/platforms.json").read_text(encoding="utf-8"))
    counts = {}
    highlights = {}
    for day in manifest["days"]:
        directory = root / "days" / day
        encounters = json.loads((directory / "platform-encounters.json").read_text(encoding="utf-8"))
        candidates = json.loads((directory / "platform-candidates.json").read_text(encoding="utf-8"))
        kinds = Counter()
        locations = Counter()
        for trip_id, entries in list(encounters.items())+list(candidates.items()):
            if not trip_id or not isinstance(entries, list):
                raise ValueError("Malformed encounter list")
            for entry in entries:
                if not isinstance(entry, list) or len(entry) != 4:
                    raise ValueError("Malformed encounter row")
                sequence, physical_id, kind, peer_ids = entry
                if (kind not in KINDS or physical_id not in platforms or
                    not isinstance(sequence, int) or sequence < 1 or
                    not isinstance(peer_ids, list)):
                    raise ValueError("Invalid encounter metadata " + str(entry))
                kinds[kind] += 1
                if kind == "tram-branch-confirmed":
                    group_id = platforms[physical_id][0]
                    group = groups.get(group_id, [])
                    name = group[1] if len(group) > 1 else physical_id
                    locations[name] += 1
        counts[day] = dict(sorted(kinds.items()))
        highlights[day] = locations.most_common(12)
    report = {"counts": counts, "mostFrequentTramJunctionStops": highlights}
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    missing = [day for day, values in counts.items()
               if day >= manifest["referenceDay"] and manifest["days"][day]["available"] and
               (values.get("mixed-platform", 0) == 0 or
                values.get("tram-branch-confirmed", 0) == 0)]
    if missing:
        raise ValueError("Missing verified geometry for " + ", ".join(missing))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path, nargs="?", default=Path("public/data/pid/v1"))
    args = parser.parse_args()
    audit(args.root)
