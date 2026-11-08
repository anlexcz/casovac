/** Timetable candidates for exact PID GTFS stop_id and service day.
 * Search widely for severely delayed services, but display only nearby ETAs.
 * LIVE delay and vehicle identity are joined separately by trip_id.
 */
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine} from './pidStatic.ts';
import type {DepartureBoard} from './stopNeighbourBoard.ts';
type Source=Pick<PidStaticEngine,'getDepartures'|'getRoutes'>;
export const STATIC_LOOKBACK_SECONDS=45*60;
export const STATIC_LOOKAHEAD_SECONDS=20*60;
export async function staticNeighbourBoard(stopId:string,date:string,ownSeconds:number,
 source:Source=pidStatic):Promise<DepartureBoard>{
 if(!stopId||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||
  !Number.isFinite(ownSeconds))throw Error('Chybí ověřená GTFS zastávka, den nebo čas.');
 const [all,routes]=await Promise.all([
  source.getDepartures(stopId,date),source.getRoutes()
 ]);
 const departures=all.filter(d=>
  d.stopId===stopId&&d.date===date&&
  d.departureSeconds>=ownSeconds-STATIC_LOOKBACK_SECONDS&&
  d.departureSeconds<=ownSeconds+STATIC_LOOKAHEAD_SECONDS&&
  routes[d.routeId]?.[2]==='0'&&!!routes[d.routeId]?.[0]
 ).map(d=>({
  trip:{id:d.tripId},route:{short_name:routes[d.routeId][0],type:0},
  stop:{id:stopId},scheduledSeconds:d.departureSeconds
 }));
 return {departures};
}
