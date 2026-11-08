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

/**
 * The full operating block can contain arbitrarily many route changes.
 * Only neighbouring trips in chronological order may form a handoff.
 * Never jump over an intermediate trip just because it shares a terminal.
 */
export type StaticBlockLinks={previous:BlockPair|null;next:BlockPair|null};
const EMPTY:StaticBlockLinks={previous:null,next:null};
export async function findStaticBlockLinks(
 tripId:string,line:string,date:string,
 source:StaticBlockSource=pidStatic
):Promise<StaticBlockLinks>{
 if(!tripId||!line||!/^\d{4}-\d{2}-\d{2}$/.test(date))return EMPTY;
 const current=await source.getTrip(tripId,date);
 if(!current||current.id!==tripId||current.date!==date||!current.blockId)return EMPTY;
 const routes=await source.getRoutes();
 if(routes[current.routeId]?.[0]!==line)return EMPTY;
 const block=await source.getBlockTrips(current.blockId,date);
 // Do not impose a maximum number of trips: long all-day blocks are valid.
 if(block.length<2)return EMPTY;
 const ordered=[...block].sort((a,b)=>a.startSeconds-b.startSeconds||a.id.localeCompare(b.id));
 const matches=ordered.map((entry,index)=>entry.id===tripId&&entry.routeId===current.routeId?index:-1)
  .filter(index=>index>=0);
 if(matches.length!==1)return EMPTY; // mismatched or duplicated block identity
 const index=matches[0];
 const currentItem=ordered[index];
 // Tied timestamps make chronological adjacency uncertain.
 if((index>0&&ordered[index-1].startSeconds===currentItem.startSeconds)||
    (index<ordered.length-1&&ordered[index+1].startSeconds===currentItem.startSeconds))
  return EMPTY;
 const currentStops=await source.getTripStops(tripId,date,current.routeId);
 if(!validStops(currentStops))return EMPTY;
 const original=stopsForBoundary(currentStops);
 const check=async(entryIndex:number,role:'first'|'second'):Promise<BlockPair|null>=>{
  const entry=ordered[entryIndex];
  if(!entry||entry.startSeconds===currentItem.startSeconds)return null;
  // A duplicate departure time around either neighbour destroys the
  // uniqueness of its position in the chronological block.
  if((entryIndex>0&&ordered[entryIndex-1].startSeconds===entry.startSeconds)||
     (entryIndex<ordered.length-1&&ordered[entryIndex+1].startSeconds===entry.startSeconds))
   return null;
  const otherLine=routes[entry.routeId]?.[0]??'';
  // A same-line trip is still the immediate block neighbour, but not a
  // *route change*: never skip it to reach a more distant different line.
  if(!otherLine||otherLine===line)return null;
  const other=await source.getTrip(entry.id,date,entry.routeId);
  if(!other||other.id!==entry.id||other.date!==date||other.blockId!==current.blockId||
     other.routeId!==entry.routeId)return null;
  const otherStops=await source.getTripStops(entry.id,date,entry.routeId);
  if(!validStops(otherStops))return null;
  const compared=stopsForBoundary(otherStops);
  const first=role==='first'?original:compared;
  const second=role==='first'?compared:original;
  if(!validBlockBoundary(first,second))return null;
  // Ensure GTFS stop_times agree with the indexed first-departure order.
  if(!other.stopTimes.length||!current.stopTimes.length||
     !Number.isFinite(current.stopTimes[0][2])||
     !Number.isFinite(other.stopTimes[0][2]))return null;
  const firstTime=role==='first'?current.stopTimes[0][2]:other.stopTimes[0][2];
  const secondTime=role==='first'?other.stopTimes[0][2]:current.stopTimes[0][2];
  if(secondTime<firstTime)return null;
  return {
   partner:partner(other.id,otherLine,'PID GTFS block_id'),
   role,blockId:current.blockId,
   firstId:role==='first'?tripId:other.id,
   secondId:role==='first'?other.id:tripId,
   reason:'Shodné block_id, sousední tripy a ověřená přechodová zastávka v PID GTFS.'
  };
 };
 const [previous,next]=await Promise.all([
  index>0?check(index-1,'second'):Promise.resolve(null),
  index<ordered.length-1?check(index+1,'first'):Promise.resolve(null)
 ]);
 return {previous,next};
}
/** Backward-compatible two-trip API: prefer upcoming link, otherwise previous.
 * Call findStaticBlockLinks() when both sides are needed.
 */
export async function findStaticBlockPair(
 tripId:string,line:string,date:string,
 source:StaticBlockSource=pidStatic
):Promise<BlockPair|null>{
 const links=await findStaticBlockLinks(tripId,line,date,source);
 return links.next??links.previous;
}
