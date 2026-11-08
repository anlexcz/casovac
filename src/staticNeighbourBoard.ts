/** Planned departures on a confirmed physical boarding edge, or exact GTFS stop.
 * Search widely for delayed services; only the presentation applies ±120 s.
 * PID physical registry is the sole authority for GTFS stop-id equivalence.
 */
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine} from './pidStatic.ts';
import {physicalBoardingIds} from './physicalBoardingIds.ts';
import type {DepartureBoard} from './stopNeighbourBoard.ts';
type Source=Pick<PidStaticEngine,'getDepartures'|'getRoutes'> &
 Partial<Pick<PidStaticEngine,'getStopMap'|'getPlatforms'>>;
export const STATIC_LOOKBACK_SECONDS=45*60;
export const STATIC_LOOKAHEAD_SECONDS=20*60;
export const ROAD_MODES=new Set(['0','3','11']);
export async function staticNeighbourBoard(stopId:string,date:string,ownSeconds:number,
 source:Source=pidStatic):Promise<DepartureBoard>{
 if(!stopId||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||
  !Number.isFinite(ownSeconds))throw Error('Chybí ověřená GTFS zastávka, den nebo čas.');
 const confirmed=source.getStopMap&&source.getPlatforms
  ?await physicalBoardingIds(stopId,source as Pick<PidStaticEngine,'getStopMap'|'getPlatforms'>)
  :[stopId];
 const [lists,routes]=await Promise.all([
  Promise.all(confirmed.map(id=>source.getDepartures(id,date))),source.getRoutes()
 ]);
 const allowed=new Set(confirmed);
 const departures=lists.flat().filter(d=>
  allowed.has(d.stopId)&&d.date===date&&
  d.departureSeconds>=ownSeconds-STATIC_LOOKBACK_SECONDS&&
  d.departureSeconds<=ownSeconds+STATIC_LOOKAHEAD_SECONDS&&
  ROAD_MODES.has(routes[d.routeId]?.[2]??'')&&!!routes[d.routeId]?.[0]
 ).map(d=>({
  trip:{id:d.tripId},
  route:{short_name:routes[d.routeId][0],type:Number(routes[d.routeId][2])},
  stop:{id:d.stopId},
  scheduledSeconds:d.departureSeconds,stopSequence:d.stopSequence
 }));
 return {departures};
}
