/** Static-first stop sequences for the neighbouring departures panel.
 * Golemio departureboards remain authoritative for live departure/delay data.
 * A candidate's local GTFS identity is accepted only when it matches the
 * exact trip, service day, route and *boarding-edge* stop ID on that board.
 */
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine,PidTripStop} from './pidStatic.ts';
import type {Stop} from './tripData.ts';

type Source=Pick<PidStaticEngine,'getTripResolved'|'getTripStops'|'getRoutes'>;
const clock=/^\d{2,}:\d{2}:\d{2}$/;
const valid=(items:PidTripStop[]|null):items is PidTripStop[]=>
 !!items&&items.length>=2&&items.every(s=>
  !!s.id&&!!s.name&&Number.isSafeInteger(s.sequence)&&
  clock.test(s.arrival)&&clock.test(s.departure)&&
  Number.isFinite(s.lat)&&Number.isFinite(s.lon));

export async function getStaticNeighbourStops(
 tripId:string,day:string,boardStopId:string,routeShortName:string,
 source:Source=pidStatic
):Promise<Stop[]|null>{
 if(!tripId||!boardStopId||!routeShortName||!/^\d{4}-\d{2}-\d{2}$/.test(day))
  return null;
 const trip=await source.getTripResolved(tripId,day);
 if(!trip||trip.id!==tripId||trip.date!==day||!trip.routeId)return null;
 const routes=await source.getRoutes();
 if(routes[trip.routeId]?.[0]!==routeShortName)return null;
 const stops=await source.getTripStops(tripId,day,trip.routeId);
 if(!valid(stops)||stops.length!==trip.stopTimes.length)return null;
 // The PID physical stop-map is useful for passenger presentation, but
 // must NOT substitute a different GTFS stop_id for the board's exact edge.
 if(!stops.some(s=>s.id===boardStopId))return null;
 return stops.map(s=>({id:s.id,name:s.name,sequence:s.sequence,
  arrival:s.arrival,departure:s.departure,
  lat:s.lat,lon:s.lon,platformCode:s.platformCode}));
}

/** Static source first with fail-open legacy fetch. Fallback must never be
 * suppressed by a damaged/missing PID shard or GTFS version mismatch.
 */
export async function resolveNeighbourStops(args:{
 tripId:string;date:string;boardStopId:string;routeShortName:string;
 staticAllowed:boolean;fallback:()=>Promise<Stop[]>;
 source?:Source;
}):Promise<{stops:Stop[];source:'PID GTFS'|'Golemio'}>{
 const {tripId,date,boardStopId,routeShortName,staticAllowed,fallback,source}=args;
 if(staticAllowed){
  try{
   const stops=await getStaticNeighbourStops(tripId,date,boardStopId,routeShortName,source);
   if(stops)return {stops,source:'PID GTFS'};
  }catch{/* Missing/invalid/unavailable static data: retain online fallback. */}
 }
 return {stops:await fallback(),source:'Golemio'};
}
