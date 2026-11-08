"""Conservative geometry evidence for two *incoming* GTFS shape corridors.

Return True only when both shapes can be matched unambiguously to the
previous and target stop in the correct order, and are substantially
separated upstream yet converge onto the same physical platform.
No coordinates, repeated ambiguous passages or short approaches => unknown.
"""
from math import cos, radians, hypot

STOP_SNAP_METRES = 35.0
UPSTREAM_METRES = 140.0
NEAR_METRES = 20.0
UPSTREAM_MIN_SEPARATION = 75.0
NEAR_MAX_SEPARATION = 55.0


def _xy(point, latitude):
    return (float(point[1]) * 111320 * cos(radians(latitude)),
            float(point[0]) * 111320)


def _project(polyline, point):
    """Return every near shape projection as (length_along, error)."""
    result = []
    passed = 0.0
    for a, b in zip(polyline, polyline[1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = hypot(dx, dy)
        if length < 0.01:
            continue
        t = max(0.0, min(1.0, ((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(length*length)))
        x, y = a[0]+t*dx, a[1]+t*dy
        error = hypot(point[0]-x, point[1]-y)
        if error <= STOP_SNAP_METRES:
            result.append((passed+t*length, error))
        passed += length
    # A stop within 35 m of a curving polyline produces several projections
    # on neighbouring segments. Treat that as ONE visit to the stop. Do not
    # merge a true revisit to the same platform hundreds of metres later.
    clusters = []
    for along, err in sorted(result):
        if clusters and along-clusters[-1][-1][0] <= 80:
            clusters[-1].append((along, err))
        else:
            clusters.append([(along, err)])
    return [min(cluster, key=lambda item: item[1]) for cluster in clusters]


def _at(polyline, target):
    passed = 0.0
    for a, b in zip(polyline, polyline[1:]):
        length = hypot(b[0]-a[0], b[1]-a[1])
        if length < 0.01:
            continue
        if target <= passed+length:
            t = max(0.0, min(1.0, (target-passed)/length))
            return a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])
        passed += length
    return polyline[-1]


def incoming_points(shape, preceding, target):
    """Coordinates (near, far) or None, with ambiguity rejected.

    Stop-based projection rejects repeated visits to the same previous/target
    pair rather than choosing the first and wrongly classifying a loop.
    """
    if not shape or len(shape) < 2 or preceding is None or target is None:
        return None
    try:
        lat = float(target[0])
        points = [_xy(row, lat) for row in shape]
        prev = _xy(preceding, lat)
        stop = _xy(target, lat)
    except (TypeError, ValueError, IndexError):
        return None
    previous_projections = _project(points, prev)
    target_projections = _project(points, stop)
    # Require the previous stop to genuinely precede the joint platform
    # along the GTFS shape; prevent backwards or looping selections.
    pairs = [(p, q) for p, pe in previous_projections
             for q, qe in target_projections
             if q-p >= UPSTREAM_METRES and q>p]
    if len(pairs) != 1:
        return None
    _, end = pairs[0]
    return _at(points, end-NEAR_METRES), _at(points, end-UPSTREAM_METRES)


def different_incoming_branches(first, second):
    """True = confirmed distinct incoming geometric corridors; else unknown."""
    if first is None or second is None:
        return False
    near_one, far_one = first
    near_two, far_two = second
    far_distance = hypot(far_one[0]-far_two[0],far_one[1]-far_two[1])
    near_distance = hypot(near_one[0]-near_two[0],near_one[1]-near_two[1])
    return (far_distance >= UPSTREAM_MIN_SEPARATION and
            near_distance <= NEAR_MAX_SEPARATION and
            far_distance-near_distance >= 45.0)


def same_incoming_corridor(first, second):
    """Conservative veto: both verified approach samples use the same corridor.

    Only close near *and* far samples prove a shared approach. A missing
    or ambiguous shape never vetoes GTFS stop-sequence line-set evidence.
    """
    if first is None or second is None:
        return False
    near_a, far_a = first
    near_b, far_b = second
    return (hypot(near_a[0]-near_b[0], near_a[1]-near_b[1]) <= 22.0 and
            hypot(far_a[0]-far_b[0], far_a[1]-far_b[1]) <= 22.0)
