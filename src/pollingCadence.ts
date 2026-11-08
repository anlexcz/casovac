/** Refresh cadence and retained fallback snapshots.
 * Retention is NOT a LIVE freshness guarantee; use origin_timestamp for that.
 */
export const OWN_VEHICLE_POLL_MS=20_000;
export const OWN_VEHICLE_RETAIN_MS=3*OWN_VEHICLE_POLL_MS;
export const NEIGHBOUR_POLL_MS=60_000;
export const NEIGHBOUR_RETAIN_MS=3*NEIGHBOUR_POLL_MS;
export const UPCOMING_STOP_COUNT=3;
