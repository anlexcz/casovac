"""Precompute exact physical-platform encounters for the Časovač 5B panel.

Only the authoritative PID stop registry may equate multiple GTFS stop IDs.
A differing previous stop is merely a *candidate* branch: it does not prove
different track geometry, and must not trigger automatic tram opening yet.
"""
from collections import defaultdict
try:
    from .branch_geometry import incoming_points, different_incoming_branches, same_incoming_corridor
except ImportError:
    from branch_geometry import incoming_points, different_incoming_branches, same_incoming_corridor

SUPPORTED_MODES = {"0", "3", "11"}
TRAM = "0"
OTHER_ROAD = {"3", "11"}


def platform_encounters(day_routes, stop_times, trip_meta, routes, stop_map,
                        tolerance_seconds=120, geometry=None, gtfs_stops=None):
    """Return trip -> [stop_sequence, physical_id, kind, peer_trip_ids] records.

    kind is 'mixed-confirmed' for a near-timed bus/trolley, 'mixed-platform'
    for a physically shared tram+road platform, 'tram-branch-confirmed' for
    independently shape-proven incoming tram routes, or 'tram-route-set' from directional line sets, or 'tram-branch-candidate'
    for unverified timetable-only evidence.
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
                previous_stop_id = times[i-1][0] if i else ""
                previous = stop_map.get(previous_stop_id, "")
                visits[platform].append((arrival, trip_id, seq, mode,
                                         previous, stop_id, previous_stop_id))
    result = defaultdict(list)
    signature_cache = {}
    geometry = geometry or {}
    gtfs_stops = gtfs_stops or {}

    def signature(item):
        _, trip_id, _, _, _, target_id, preceding_id = item
        meta = trip_meta.get(trip_id, [])
        shape_id = meta[5] if len(meta) > 5 else ""
        key = (shape_id, preceding_id, target_id)
        if key not in signature_cache:
            previous = gtfs_stops.get(preceding_id)
            target = gtfs_stops.get(target_id)
            if not shape_id or not previous or not target:
                signature_cache[key] = None
            else:
                prior = (previous["a"], previous["o"])
                end = (target["a"], target["o"])
                shape = geometry.get(shape_id, [])
                signature_cache[key] = incoming_points(
                    [[row[1], row[2]] for row in shape], prior, end)
        return signature_cache[key]

    for physical_id, items in visits.items():
        items.sort(key=lambda row: (row[0], row[1], row[2]))
        # Static stop topology is independent of whether the next road service
        # happens to be within two minutes. A quiet shared platform is still
        # relevant and may legitimately show "no nearby services".
        has_road_modes = any(item[3] in OTHER_ROAD for item in items)
        # Compare the *sets of directional lines using the previous physical
        # platform* with the set reaching this exact common platform. A line
        # newly present at the platform is an incoming branch, including when
        # its subsequent route immediately diverges. Unlike GTFS shape
        # projection, this comparison is robust to curve sampling and does not
        # need a near-time service on the current operating day.
        tram_paths = {}
        for item in items:
            if item[3] != TRAM or not item[4]:
                continue
            meta = trip_meta.get(item[1], [])
            route_id = meta[0] if len(meta) > 0 else ""
            shape_id = meta[5] if len(meta) > 5 else ""
            line = routes.get(route_id, [""])[0]
            key = (route_id, shape_id, item[6], item[5])
            if key not in tram_paths:
                tram_paths[key] = (item[4], line, item)
        incoming_lines = defaultdict(set)
        for previous, line, _item in tram_paths.values():
            if line:
                incoming_lines[previous].add(line)
        distinct_incoming = len(incoming_lines) > 1
        all_lines = set().union(*incoming_lines.values()) if incoming_lines else set()
        # Incoming stop identifiers represent stop-level branches, not
        # necessarily separate tracks. Geometry, when confidently shared,
        # can veto a false positive on an identical incoming corridor.
        route_set_paths = set()
        if distinct_incoming:
            for key, (previous, line, own_item) in tram_paths.items():
                novel = all_lines - incoming_lines[previous]
                different_predecessors = [
                    peer for peer in tram_paths.values()
                    if peer[0] != previous and peer[1]
                ]
                if not novel and not any(peer[1] == line for peer in different_predecessors):
                    continue
                own_geometry = signature(own_item)
                for other_previous, other_line, other_item in different_predecessors:
                    if novel and other_line not in novel:
                        continue
                    other_geometry = signature(other_item)
                    if (own_geometry is not None and other_geometry is not None and
                        same_incoming_corridor(own_geometry, other_geometry)):
                        continue
                    route_set_paths.add(key)
                    break
        # Separately calculate stronger shape-proven evidence. A divergent
        # outgoing track is never a requirement for either classification.
        unique_paths = {}
        for item in items:
            if item[3] != TRAM or not item[6]:
                continue
            meta = trip_meta.get(item[1], [])
            key = (meta[5] if len(meta) > 5 else "", item[6], item[5])
            if key not in unique_paths:
                unique_paths[key] = (item[4], signature(item))
        verified_paths = set()
        path_items = list(unique_paths.items())
        for i, (first_key, (first_previous, first_signature)) in enumerate(path_items):
            if first_signature is None:
                continue
            for second_key, (second_previous, second_signature) in path_items[i+1:]:
                if (not first_previous or not second_previous or
                    first_previous == second_previous):
                    continue
                if different_incoming_branches(first_signature, second_signature):
                    verified_paths.add(first_key)
                    verified_paths.add(second_key)
        left = 0
        for arrival, trip_id, seq, mode, previous, stop_id, preceding_id in items:
            if mode != TRAM:
                continue
            while left < len(items) and items[left][0] < arrival-tolerance_seconds:
                left += 1
            mixed = set()
            tram_candidates = set()
            for other_arrival, other_trip, other_seq, other_mode, other_previous, _, _ in items[left:]:
                if other_arrival > arrival+tolerance_seconds:
                    break
                if other_trip == trip_id:
                    continue
                if other_mode in OTHER_ROAD:
                    mixed.add(other_trip)
                elif other_mode == TRAM and previous and other_previous and previous != other_previous:
                    tram_candidates.add(other_trip)
            if has_road_modes:
                result[trip_id].append([seq, physical_id, "mixed-platform", []])
            meta = trip_meta.get(trip_id, [])
            own_path = (meta[5] if len(meta) > 5 else "", preceding_id, stop_id)
            if own_path in verified_paths:
                result[trip_id].append([seq, physical_id, "tram-branch-confirmed", []])
            else:
                route_id = meta[0] if len(meta) else ""
                if (route_id, own_path[0], preceding_id, stop_id) in route_set_paths:
                    result[trip_id].append([seq, physical_id, "tram-route-set", []])
            if mixed:
                result[trip_id].append([seq, physical_id, "mixed-confirmed", sorted(mixed)])
            if tram_candidates:
                result[trip_id].append([seq, physical_id, "tram-branch-candidate", sorted(tram_candidates)])
    return dict(sorted(result.items()))
