/** Phase 3B: discover a GTFS block handoff from the local PID service day.
 * Static block identity is used only with an exact trip and a valid terminal
 * transition; never invent order/vehicle numbers from block_id or route.
 */
import {validBlockBoundary} from './blockPair.ts';
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine,PidTripStop} from './pidStatic.ts';
import type {BlockPair} from './blockPair.ts';
import type {ChainTrip} from './chainDiagnostics.ts';
import type {Stop} from './tripData.ts';

type StaticBlockSource=Pick<PidStaticEngine,'getTrip'|'getBlockTrips'|'getTripStops'|'getRoutes'>;

const validStops=(items:PidTripStop[]|null):items is PidTripStop[]=>
 !!items&&items.length>=2&&items.every(s=>
  !!s.id&&!!s.name&&Number.isSafeInteger(s.sequence)&&
  /^\d{2,}:\d{2}:\d{2}$/.test(s.arrival)&&
  /^\d{2,}:\d{2}:\d{2}$/.test(s.departure));

const stopsForBoundary=(items:PidTripStop[]):Stop[]=>
 items.map(s=>({id:s.id,name:s.name,sequence:s.sequence,arrival:s.arrival,
  departure:s.departure,lat:s.lat,lon:s.lon,platformCode:s.platformCode}));

const partner=(tripId:string,line:string,source:string):ChainTrip=>({
 line,order:'',tripId,vehicle:'',state:'before_track',start:null,
 lastStop:null,nextStop:null,rawTrip:null,source
});

/** Returns null for absent or ambiguous links; leave the caller's Golemio
 * discovery path intact in those cases. Service date must already be vetted.
 */
export async function findStaticBlockPair(
 tripId:string,line:string,date:string,
 source:StaticBlockSource=pidStatic
):Promise<BlockPair|null>{
 if(!tripId||!line||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const current=await source.getTrip(tripId,date);
 if(!current||current.id!==tripId||!current.blockId)return null;
 const routes=await source.getRoutes();
 if(routes[current.routeId]?.[0]!==line)return null;
 const blocks=await source.getBlockTrips(current.blockId,date);
 if(!blocks.some(item=>item.id===tripId&&item.routeId===current.routeId))return null;
 if(blocks.length<2||blocks.length>16)return null;
 const currentStops=await source.getTripStops(tripId,date,current.routeId);
 if(!validStops(currentStops))return null;
 const original=stopsForBoundary(currentStops);
 const matches:BlockPair[]=[];
 for(const entry of blocks){
  if(entry.id===tripId)continue;
  const otherLine=routes[entry.routeId]?.[0]??'';
  if(!otherLine||otherLine===line)continue;
  const other=await source.getTrip(entry.id,date,entry.routeId);
  if(!other||other.id!==entry.id||other.blockId!==current.blockId)continue;
  const otherStops=await source.getTripStops(entry.id,date,entry.routeId);
  if(!validStops(otherStops))continue;
  const compared=stopsForBoundary(otherStops);
  const currentFirst=validBlockBoundary(original,compared);
  const otherFirst=validBlockBoundary(compared,original);
  if(currentFirst===otherFirst)continue;
  // GTFS block boundaries must have chronological first departures.
  const currentStart=current.stopTimes[0]?.[1];
  const otherStart=other.stopTimes[0]?.[1];
  if(!Number.isFinite(currentStart)||!Number.isFinite(otherStart)||
    (currentFirst&&currentStart>otherStart)||
    (otherFirst&&otherStart>currentStart))continue;
  const firstId=currentFirst?tripId:other.id;
  const secondId=currentFirst?other.id:tripId;
  matches.push({
   partner:partner(other.id,otherLine,'PID GTFS block_id'),
   role:currentFirst?'first':'second',blockId:current.blockId,
   firstId,secondId,
   reason:'Shodné block_id a ověřená přechodová zastávka z lokálního PID GTFS.'
  });
  // Multiple equally plausible continuations are ambiguous, never choose one.
  if(matches.length>1)return null;
 }
 return matches.length===1?matches[0]:null;
}
