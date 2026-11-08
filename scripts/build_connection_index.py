"""Precompute exact physical-platform encounters for the Časovač 5B panel.

Only the authoritative PID stop registry may equate multiple GTFS stop IDs.
A differing previous stop is merely a *candidate* branch: it does not prove
different track geometry, and must not trigger automatic tram opening yet.
"""
from collections import defaultdict

SUPPORTED_MODES = {"0", "3", "11"}
TRAM = "0"
OTHER_ROAD = {"3", "11"}


def platform_encounters(day_routes, stop_times, trip_meta, routes, stop_map,
                        tolerance_seconds=120):
    """Return trip -> [stop_sequence, physical_id, kind, peer_trip_ids] records.

    kind is 'mixed-confirmed' for a same-platform bus/trolley within the
    scheduled interval, or 'tram-branch-candidate' requiring shape verification.
    A trip may visit a platform repeatedly; stop_sequence keeps visits distinct.
    This is a *planned* index, never a statement about live vehicle position.
    """
    if tolerance_seconds < 0:
        raise ValueError("Negative encounter tolerance")
    visits = defaultdict(list)
    for route_id, trip_ids in day_routes.items():
        mode = routes.get(route_id, ["", "", ""])[2]
        if mode not in SUPPORTED_MODES:
            continue
        for trip_id in trip_ids:
            times = stop_times.get(trip_id, [])
            for i, (stop_id, arrival, departure, seq, *_rest) in enumerate(times):
                platform = stop_map.get(stop_id)
                if not platform:
                    continue
                previous = stop_map.get(times[i-1][0]) if i else ""
                visits[platform].append((arrival, trip_id, seq, mode, previous))
    result = defaultdict(list)
    for physical_id, items in visits.items():
        items.sort(key=lambda row: (row[0], row[1], row[2]))
        left = 0
        for arrival, trip_id, seq, mode, previous in items:
            if mode != TRAM:
                continue
            while left < len(items) and items[left][0] < arrival-tolerance_seconds:
                left += 1
            mixed = set()
            tram_candidates = set()
            for other_arrival, other_trip, other_seq, other_mode, other_previous in items[left:]:
                if other_arrival > arrival+tolerance_seconds:
                    break
                if other_trip == trip_id:
                    continue
                if other_mode in OTHER_ROAD:
                    mixed.add(other_trip)
                elif other_mode == TRAM and previous and other_previous and previous != other_previous:
                    tram_candidates.add(other_trip)
            if mixed:
                result[trip_id].append([seq, physical_id, "mixed-confirmed", sorted(mixed)])
            if tram_candidates:
                result[trip_id].append([seq, physical_id, "tram-branch-candidate", sorted(tram_candidates)])
    return dict(sorted(result.items()))
