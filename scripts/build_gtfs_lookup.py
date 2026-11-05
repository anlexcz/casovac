#!/usr/bin/env python3
"""Build a small static stop lookup for the Časovač chooser from official PID GTFS.

No Golemio token is needed. Run during GitHub Pages deployment, including the
daily scheduled deployment, so runtime selection only queries vehiclepositions.
"""
from __future__ import annotations
import csv
import io
import json
import os
from pathlib import Path
import tempfile
import urllib.request
import zipfile

FEED = "https://data.pid.cz/PID_GTFS.zip"
OUT = Path("public/data")
# PID usually uses GTFS route_type=0 for tram; include extended GTFS tram types.
TRAM_TYPES = {"0", "900", "901", "902", "903", "904", "905", "906"}

def rows(zf: zipfile.ZipFile, name: str):
    with zf.open(name) as source, io.TextIOWrapper(source, encoding="utf-8-sig", newline="") as txt:
        yield from csv.DictReader(txt)

def build(zf: zipfile.ZipFile):
    stop_names: dict[str, str] = {}
    for row in rows(zf, "stops.txt"):
        stop_id = (row.get("stop_id") or "").strip()
        stop_name = (row.get("stop_name") or "").strip()
        if stop_id and stop_name:
            stop_names[stop_id] = stop_name

    tram_routes = {
        row["route_id"]
        for row in rows(zf, "routes.txt")
        if row.get("route_id") and row.get("route_type") in TRAM_TYPES
    }
    tram_trips = {
        row["trip_id"]
        for row in rows(zf, "trips.txt")
        if row.get("route_id") in tram_routes and row.get("trip_id")
    }

    # Keep only the first stop of each tram trip, without storing an entire
    # timetable. A vehicle on a terminal can then show the next trip's origin.
    first: dict[str, tuple[int, str]] = {}
    for row in rows(zf, "stop_times.txt"):
        tid = row.get("trip_id", "")
        if tid not in tram_trips:
            continue
        sid = row.get("stop_id", "")
        seq = row.get("stop_sequence", "")
        if not sid or not seq:
            continue
        try:
            number = int(seq)
        except ValueError:
            continue
        previous = first.get(tid)
        if previous is None or number < previous[0]:
            first[tid] = (number, sid)

    trip_first = {tid: sid for tid, (_, sid) in first.items()}
    if len(stop_names) < 100 or len(trip_first) < 100:
        raise RuntimeError(f"Unexpectedly small GTFS lookup: stops={len(stop_names)}, trips={len(trip_first)}")
    return stop_names, trip_first

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tempname = tmp.name
        request = urllib.request.Request(FEED, headers={"User-Agent": "casovac-gtfs-lookup/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=120) as source:
                while block := source.read(1024 * 1024):
                    tmp.write(block)
        finally:
            tmp.flush()
    try:
        with zipfile.ZipFile(tempname) as zf:
            names, first = build(zf)
    finally:
        os.unlink(tempname)

    for name, data in [("stops.json", names), ("tram-trip-first-stops.json", first)]:
        destination = OUT / name
        destination.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True), encoding="utf-8")
        print(f"{destination}: {len(data)} entries, {destination.stat().st_size:,} bytes")

if __name__ == "__main__":
    main()
