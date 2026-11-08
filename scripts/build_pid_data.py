#!/usr/bin/env python3
"""Build Časovač's static PID indexes for service days -1/0/+1.

This builder never modifies the legacy data/stops.json files. Both source
files can be supplied locally for reproducible tests and offline verification.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
import csv
from datetime import date, datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import urllib.request
import zipfile
from zoneinfo import ZoneInfo

GTFS_URL = "https://data.pid.cz/PID_GTFS.zip"
STOPS_URL = "https://data.pid.cz/stops/json/stops.json"
REQUIRED = {"calendar.txt", "calendar_dates.txt", "routes.txt", "trips.txt",
            "stops.txt", "stop_times.txt", "shapes.txt"}
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday",
            "friday", "saturday", "sunday")


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def rows(zf: zipfile.ZipFile, name: str):
    with zf.open(name) as src, io.TextIOWrapper(src, encoding="utf-8-sig", newline="") as fp:
        yield from csv.DictReader(fp)


def seconds(value: str) -> int:
    parts = value.split(":")
    if len(parts) != 3:
        raise ValueError("Invalid GTFS time: " + repr(value))
    hour, minute, second = map(int, parts)
    if not (0 <= hour < 72 and 0 <= minute < 60 and 0 <= second < 60):
        raise ValueError("Invalid GTFS time: " + repr(value))
    return hour * 3600 + minute * 60 + second


def download(url: str, path: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "casovac-pid-builder/1.0"})
    with urllib.request.urlopen(request, timeout=120) as src, path.open("wb") as out:
        shutil.copyfileobj(src, out, 1024 * 1024)
    if path.stat().st_size < 1000:
        raise RuntimeError("Unexpectedly small downloaded source: " + url)


def active_services(zf: zipfile.ZipFile, dates: list[date]) -> dict[str, set[str]]:
    calendar = list(rows(zf, "calendar.txt"))
    wanted = {d.strftime("%Y%m%d") for d in dates}
    exceptions: dict[str, dict[str, int]] = defaultdict(dict)
    for row in rows(zf, "calendar_dates.txt"):
        if row["date"] in wanted:
            exceptions[row["date"]][row["service_id"]] = int(row["exception_type"])
    result = {}
    for day in dates:
        key = day.strftime("%Y%m%d")
        active = {
            r["service_id"] for r in calendar
            if r["start_date"] <= key <= r["end_date"] and
            r[WEEKDAYS[day.weekday()]] == "1"
        }
        for service_id, kind in exceptions.get(key, {}).items():
            if kind == 1:
                active.add(service_id)
            elif kind == 2:
                active.discard(service_id)
        result[day.isoformat()] = active
    return result


def physical_registry(data: object, gtfs: dict, min_count: int = 100):
    if not isinstance(data, dict) or not isinstance(data.get("stopGroups"), list):
        raise ValueError("Missing PID stopGroups")
    groups, platforms, mapping = {}, {}, {}
    for group in data["stopGroups"]:
        # PID node is not a unique stop-group key! Anděl and Na Knížecí
        # share node 1040; similarly many bus and train stop groups share nodes.
        node = str(group["node"])
        signature = json.dumps(
            [group.get("name"), sorted(p["id"] for p in group.get("stops", []))],
            ensure_ascii=False
        )
        group_id = node + "|" + hashlib.sha256(signature.encode()).hexdigest()[:12]
        if group_id in groups:
            raise ValueError("Duplicate PID stop group " + group_id)
        ids = []
        for platform in group.get("stops", []):
            pid = platform["id"]
            if pid in platforms:
                raise ValueError("Duplicate platform " + pid)
            gtfs_ids = platform.get("gtfsIds") or []
            platforms[pid] = [
                group_id, platform.get("platform") or "",
                platform.get("lat"), platform.get("lon"),
                platform.get("zone") or "", platform.get("mainTrafficType") or "undefined",
                platform.get("wheelchairAccess") or "unknown", gtfs_ids,
                platform.get("altIdosName") or ""
            ]
            ids.append(pid)
            for stop_id in gtfs_ids:
                if stop_id not in gtfs:
                    raise ValueError("Registry refers to absent GTFS stop " + stop_id)
                if stop_id in mapping:
                    raise ValueError("Multiple physical platforms for " + stop_id)
                mapping[stop_id] = pid
        groups[group_id] = [
            node, group.get("name") or "", group.get("municipality") or "",
            group.get("avgLat"), group.get("avgLon"), ids
        ]
    if min(len(groups), len(platforms), len(mapping)) < min_count:
        raise ValueError("Unexpectedly small PID stop registry")
    return groups, platforms, mapping


def route_file(route_id: str) -> str:
    return hashlib.sha256(route_id.encode()).hexdigest()[:16] + ".json"


def departure_bucket(stop_id: str) -> str:
    return f"{hashlib.sha256(stop_id.encode()).digest()[0] % 64:02d}"


def build(zf: zipfile.ZipFile, registry: object, root: Path,
          today: date, min_count: int = 100) -> dict:
    missing = REQUIRED - set(zf.namelist())
    if missing:
        raise ValueError("Missing GTFS files: " + ", ".join(sorted(missing)))
    days = [today + timedelta(days=i) for i in (-1, 0, 1)]
    services = active_services(zf, days)
    stops = {
        r["stop_id"]: {
            "n": r.get("stop_name") or "", "a": float(r["stop_lat"]),
            "o": float(r["stop_lon"]), "p": r.get("platform_code") or "",
            "l": r.get("location_type") or "0",
            "parent": r.get("parent_station") or ""
        }
        for r in rows(zf, "stops.txt") if r.get("stop_id")
    }
    groups, platforms, stop_map = physical_registry(registry, stops, min_count)
    routes = {
        r["route_id"]: [
            r.get("route_short_name") or "", r.get("route_long_name") or "",
            r.get("route_type") or "", r.get("route_color") or "",
            r.get("is_night") or "0", r.get("is_substitute_transport") or "0"
        ]
        for r in rows(zf, "routes.txt") if r.get("route_id")
    }
    route_names = {r: route_file(r) for r in routes}
    if len(set(route_names.values())) != len(route_names):
        raise ValueError("Route filename hash collision")
    trip_meta = {}
    day_routes = {d.isoformat(): defaultdict(list) for d in days}
    shape_owners = defaultdict(set)
    for r in rows(zf, "trips.txt"):
        trip_id, route_id, service_id = r["trip_id"], r["route_id"], r["service_id"]
        if route_id not in routes:
            raise ValueError("Unknown route: " + route_id)
        active_days = [day for day, current in services.items() if service_id in current]
        if not active_days:
            continue
        if trip_id in trip_meta:
            raise ValueError("Duplicate trip ID " + trip_id)
        shape_id = r.get("shape_id") or ""
        trip_meta[trip_id] = [
            route_id, service_id, r.get("trip_headsign") or "",
            r.get("direction_id") or "", r.get("block_id") or "",
            shape_id, r.get("trip_short_name") or ""
        ]
        for day in active_days:
            day_routes[day][route_id].append(trip_id)
        if shape_id:
            shape_owners[shape_id].add(route_id)
    if len(trip_meta) < min_count:
        raise ValueError("No scheduled trips in selected window")

    stop_times = defaultdict(list)
    selected_times = 0
    for r in rows(zf, "stop_times.txt"):
        trip_id = r["trip_id"]
        if trip_id not in trip_meta:
            continue
        stop_id = r["stop_id"]
        if stop_id not in stops:
            raise ValueError("Unknown stop " + stop_id + " on trip " + trip_id)
        stop_times[trip_id].append([
            stop_id, seconds(r["arrival_time"]), seconds(r["departure_time"]),
            int(r["stop_sequence"]), r.get("trip_operation_type") or ""
        ])
        selected_times += 1
    for trip_id in trip_meta:
        if not stop_times[trip_id]:
            raise ValueError("Missing stop_times on trip " + trip_id)
        stop_times[trip_id].sort(key=lambda x: x[3])

    geometry = defaultdict(list)
    for r in rows(zf, "shapes.txt"):
        sid = r["shape_id"]
        if sid in shape_owners:
            geometry[sid].append([
                int(r["shape_pt_sequence"]), round(float(r["shape_pt_lat"]), 6),
                round(float(r["shape_pt_lon"]), 6)
            ])
    for sid in geometry:
        geometry[sid].sort(key=lambda p: p[0])

    write_json(root / "stops/gtfs.json", stops)
    write_json(root / "stops/groups.json", groups)
    write_json(root / "stops/platforms.json", platforms)
    write_json(root / "stops/gtfs-map.json", stop_map)
    write_json(root / "routes.json", routes)
    day_counts = {}
    for day in days:
        label = day.isoformat()
        base = root / "days" / label
        locator, departures, blocks = {}, defaultdict(list), defaultdict(list)
        for route_id, tids in sorted(day_routes[label].items()):
            route_trips = {}
            for tid in tids:
                _, service, headsign, direction, block, shape, short = trip_meta[tid]
                timetable = stop_times[tid]
                route_trips[tid] = [service, headsign, direction, block,
                                    shape, short, timetable]
                locator[tid] = [route_id, route_names[route_id]]
                if block:
                    blocks[block].append([timetable[0][1], tid, route_id])
                for stop_id, arrival, departure, sequence, op in timetable:
                    departures[stop_id].append([departure, tid, route_id, sequence])
            write_json(base / "routes" / route_names[route_id], route_trips)
        buckets = defaultdict(dict)
        for stop_id, events in departures.items():
            events.sort(key=lambda e: (e[0], e[1], e[3]))
            buckets[departure_bucket(stop_id)][stop_id] = events
        for bucket_id, contents in buckets.items():
            write_json(base / "departures" / (bucket_id + ".json"), contents)
        for entries in blocks.values():
            entries.sort(key=lambda e: (e[0], e[1]))
        write_json(base / "trips.json", locator)
        write_json(base / "blocks.json", blocks)
        day_counts[label] = {
            "trips": len(locator), "departures": sum(map(len, departures.values())),
            "routes": len(day_routes[label]), "platforms": len(departures),
            "buckets": len(buckets), "blocks": len(blocks),
            "available": bool(locator)
        }
    shape_files = defaultdict(dict)
    for shape_id, owners in shape_owners.items():
        points = [[p[1], p[2]] for p in geometry.get(shape_id, [])]
        if not points:
            raise ValueError("Missing shape geometry " + shape_id)
        for route_id in owners:
            shape_files[route_id][shape_id] = points
    for route_id, data in shape_files.items():
        write_json(root / "shapes" / route_names[route_id], data)

    cal = list(rows(zf, "calendar.txt"))
    manifest = {
        "schema": "casovac-pid-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "referenceDay": today.isoformat(),
        "timezone": "Europe/Prague",
        "days": day_counts,
        "feed": {
            "gtfsUrl": GTFS_URL, "stopsUrl": STOPS_URL,
            "startDate": min((r["start_date"] for r in cal), default=""),
            "endDate": max((r["end_date"] for r in cal), default=""),
            "stopsGeneratedAt": registry.get("generatedAt") if isinstance(registry, dict) else None
        },
        "counts": {
            "physicalGroups": len(groups), "physicalPlatforms": len(platforms),
            "mappedGtfsIds": len(stop_map), "gtfsStops": len(stops),
            "routes": len(routes), "uniqueTrips": len(trip_meta),
            "selectedStopTimes": selected_times, "shapes": len(geometry)
        },
        "format": {
            "routeHash": "sha256(route_id)[:16]+'.json'",
            "bucket": "sha256(stop_id).digest()[0] % 64, decimal 00..63",
            "tripLocator": "[routeId,routeFilename] by tripId",
            "time": "seconds since GTFS service-day midnight; values may exceed 86400",
            "trip": "[serviceId,headsign,directionId,blockId,shapeId,shortName,[[stopId,arrival,departure,sequence,operationType],...]]",
            "departure": "[departureSeconds,tripId,routeId,stopSequence]",
            "platform": "[groupId,platformCode,lat,lon,zone,mode,wheelchair,gtfsIds,alternateName]",
            "group": "[nodeId,name,municipality,lat,lon,physicalPlatformIds]"
        }
    }
    # A release manifest pins each shard's bytes. Clients reject mixed-generation
    # assets instead of silently combining old and new timetable files.
    manifest["checksums"] = {
        file.relative_to(root).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
        for file in sorted(root.rglob("*.json"))
        if file.name != "manifest.json"
    }
    write_json(root / "manifest.json", manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gtfs", type=Path)
    parser.add_argument("--stops", type=Path)
    parser.add_argument("--today", type=date.fromisoformat)
    parser.add_argument("--out", type=Path, default=Path("public/data/pid/v1"))
    args = parser.parse_args()
    today = args.today or datetime.now(ZoneInfo("Europe/Prague")).date()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pid-feeds-") as work:
        workdir = Path(work)
        gtfs_file = args.gtfs or workdir / "PID_GTFS.zip"
        stops_file = args.stops or workdir / "stops.json"
        if not args.gtfs:
            download(GTFS_URL, gtfs_file)
        if not args.stops:
            download(STOPS_URL, stops_file)
        with stops_file.open(encoding="utf-8") as inp:
            stop_data = json.load(inp)
        stage = Path(tempfile.mkdtemp(prefix=".pid-stage-", dir=args.out.parent))
        try:
            with zipfile.ZipFile(gtfs_file) as zf:
                manifest = build(zf, stop_data, stage, today)
            previous = args.out.with_name(args.out.name + ".backup")
            if previous.exists():
                shutil.rmtree(previous)
            if args.out.exists():
                args.out.rename(previous)
            try:
                stage.rename(args.out)
            except Exception:
                if previous.exists():
                    previous.rename(args.out)
                raise
            if previous.exists():
                shutil.rmtree(previous)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    print(json.dumps({"status": "ok", "counts": manifest["counts"],
                      "days": manifest["days"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
