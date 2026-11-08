/** Phase 3: adapt verified static GTFS to the established trip-data/route shape.
 * An incomplete GTFS asset must never disable GPS route matching or stop order.
 */
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine,PidTrip,PidTripStop,PidShapePoint} from './pidStatic.ts';

export type StaticTripContent={
 stops:Array<{id:string;name:string;sequence:number;arrival:string;departure:string;
  lat:number|null;lon:number|null;platformCode:string}>;
 headsign:string;route:string;raw:unknown;source:string;
};
const validDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day);
export function adaptStaticTrip(trip:PidTrip,stops:PidTripStop[],
 shape:PidShapePoint[],routeShortName:string):StaticTripContent{
 if(!stops.length||stops.some(s=>!s.id||!s.name||!Number.isInteger(s.sequence)||
   !/^\d{2,}:\d{2}:\d{2}$/.test(s.arrival)||!/^\d{2,}:\d{2}:\d{2}$/.test(s.departure)))
  throw new Error('Neúplné statické zastávky GTFS.');
 if(shape.length<2||shape.some(p=>!Array.isArray(p)||p.length!==2||
   !Number.isFinite(p[0])||!Number.isFinite(p[1])))
  throw new Error('Chybí platná geometrie trasy; ponechávám Golemio.');
 if(!trip.headsign||!routeShortName)throw new Error('Chybí směr nebo linka statického tripu.');
 // decodeRoute() expects a Golemio-compatible GeoJSON shape, not PID's lat/lon tuples.
 const features=shape.map(([lat,lon])=>({geometry:{coordinates:[lon,lat]}}));
 return {
  stops:stops.map(s=>({id:s.id,name:s.name,sequence:s.sequence,
   arrival:s.arrival,departure:s.departure,lat:s.lat,lon:s.lon,platformCode:s.platformCode})),
  headsign:trip.headsign,route:routeShortName,
  raw:{shapes:{features}},source:'PID GTFS · statický jízdní řád'
 };
}
/** Static is preferred only with an explicit, verified service day for this trip. */
export async function loadVerifiedStaticTrip(
 tripId:string,serviceDate:string,routeShortName:string,
 engine:Pick<PidStaticEngine,'getTrip'|'getTripStops'|'getRouteShape'>=pidStatic
):Promise<StaticTripContent>{
 if(!tripId||!validDate(serviceDate)||!routeShortName)
  throw new Error('Chybí ověřené provozní datum nebo linka.');
 const trip=await engine.getTrip(tripId,serviceDate);
 if(!trip||trip.id!==tripId)throw new Error('Trip není v lokálním GTFS.');
 // Exact same stop sequence as the canonical static trip and shape required.
 const stops=await engine.getTripStops(tripId,serviceDate,trip.routeId);
 if(!stops||stops.length!==trip.stopTimes.length)
  throw new Error('Neúplná sekvence zastávek.');
 if(!trip.routeId||!trip.shapeId)
  throw new Error('Statický trip neobsahuje geometrii.');
 const shape=await engine.getRouteShape(trip.routeId,trip.shapeId);
 if(!shape)throw new Error('Geometrie trasy není v GTFS.');
 return adaptStaticTrip(trip,stops,shape,routeShortName);
}
