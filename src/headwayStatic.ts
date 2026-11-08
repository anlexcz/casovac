/** PID static schedules for headways: scheduled times/stop IDs never depend
 * on Golemio. Live vehicle positions and delays still come from Golemio.
 */
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine,PidTripStop} from './pidStatic.ts';
import {findStaticBlockLinks} from './staticBlockPair.ts';
import {validBlockBoundary} from './blockPair.ts';
import type {HeadwayTripDetail} from './headwayChains.ts';
import type {HeadwayLink} from './headwayLinkEligibility.ts';
import type {Stop} from './tripData.ts';

type Source=Pick<PidStaticEngine,'getTripResolved'|'getTripStops'|'getRoutes'|
 'getTrip'|'getBlockTrips'>;
export type StaticHeadwayDetail=HeadwayTripDetail&{pidStatic:true};
export type StaticHeadwayChain={stops:Stop[];link:HeadwayLink|null;lines:string[]};
const valid=(rows:PidTripStop[]|null):rows is PidTripStop[]=>!!rows&&rows.length>=2&&
 rows.every(s=>!!s.id&&!!s.name&&Number.isSafeInteger(s.sequence)&&
  /^\d{2,}:\d{2}:\d{2}$/.test(s.arrival)&&
  /^\d{2,}:\d{2}:\d{2}$/.test(s.departure));
export function asHeadwayStops(rows:PidTripStop[]):Stop[]{
 return rows.map(s=>({id:s.id,name:s.name,sequence:s.sequence,
  arrival:s.arrival,departure:s.departure,lat:s.lat,lon:s.lon,
  platformCode:s.platformCode}));
}
export async function getStaticHeadwayDetail(id:string,day:string,
 source:Source=pidStatic):Promise<StaticHeadwayDetail|null>{
 if(!id||!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
 const trip=await source.getTripResolved(id,day);
 if(!trip||trip.id!==id||trip.date!==day)return null;
 const routes=await source.getRoutes();
 const shortName=routes[trip.routeId]?.[0];
 if(!shortName)return null;
 const stops=await source.getTripStops(id,day,trip.routeId);
 if(!valid(stops)||stops.length!==trip.stopTimes.length)return null;
 return {trip_id:id,block_id:trip.blockId,
  route:{route_short_name:shortName},
  stop_times:asHeadwayStops(stops).map(s=>({
   stop_id:s.id,stop_name:s.name,stop_sequence:s.sequence,
   arrival_time:s.arrival,departure_time:s.departure,
   stop_lat:s.lat,stop_lon:s.lon,platform_code:s.platformCode
  })),pidStatic:true};
}
/** Get one proven neighbouring route change, without online terminal scans.
 * Middle trips may have predecessor and successor; use nearest verified link
 * to the CURRENT trip for headway comparison, never jump two legs.
 */
export async function getStaticHeadwayChain(id:string,line:string,day:string,
 source:Source=pidStatic):Promise<StaticHeadwayChain|null>{
 const detail=await getStaticHeadwayDetail(id,day,source);
 if(!detail)return null;
 const own=detail.stop_times as Array<{stop_id:string;stop_name:string;
  stop_sequence:number;arrival_time:string;departure_time:string;
  stop_lat:number|null;stop_lon:number|null;platform_code:string}>;
 const ownStops:Stop[]=own.map(s=>({id:s.stop_id,name:s.stop_name,sequence:s.stop_sequence,
  arrival:s.arrival_time,departure:s.departure_time,lat:s.stop_lat,
  lon:s.stop_lon,platformCode:s.platform_code}));
 if(detail.route?.route_short_name!==line)return null;
 const links=await findStaticBlockLinks(id,line,day,source);
 const lines=[...new Set([links.previous?.partner.line,links.next?.partner.line]
  .filter((value):value is string=>!!value&&value!==line))];
 const chosen=links.next??links.previous;
 if(!chosen)return {stops:ownStops,link:null,lines};
 const other=await getStaticHeadwayDetail(chosen.partner.tripId,day,source);
 if(!other||other.route?.route_short_name!==chosen.partner.line||
   other.block_id!==detail.block_id)return null;
 const nextRows=other.stop_times as typeof own;
 const otherStops:Stop[]=nextRows.map(s=>({id:s.stop_id,name:s.stop_name,
  sequence:s.stop_sequence,arrival:s.arrival_time,departure:s.departure_time,
  lat:s.stop_lat,lon:s.stop_lon,platformCode:s.platform_code}));
 const first=chosen.role==='first'?ownStops:otherStops;
 const second=chosen.role==='first'?otherStops:ownStops;
 if(!validBlockBoundary(first,second))return null;
 const firstLine=chosen.role==='first'?line:chosen.partner.line;
 const secondLine=chosen.role==='first'?chosen.partner.line:line;
 return {stops:[...first,...second.slice(1)],
  link:{firstId:chosen.firstId,secondId:chosen.secondId,firstLine,secondLine,
   boundaryIndex:first.length-1},lines};
}
