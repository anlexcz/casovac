/** Follow the physical GTFS block, never just the originally scheduled trip_id.
 * Only chronologically adjacent trips with verified terminal continuity qualify.
 * The return value proves a scheduled duty, NOT a live vehicle identity.
 */
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine,PidTripStop} from './pidStatic.ts';
import {validBlockBoundary} from './blockPair.ts';
import {serviceSeconds} from './headwayPeerLocation.ts';
import type {PlannedPeer} from './plannedHeadways.ts';
import type {Stop} from './tripData.ts';

type Source=Pick<PidStaticEngine,'getTripResolved'|'getBlockTrips'|'getTripStops'|'getRoutes'>;
export type DutyTrip={tripId:string;line:string;startSeconds:number;
 endSeconds?:number;terminalStopId?:string};
const mapped=(stops:PidTripStop[]):Stop[]=>
 stops.map(s=>({id:s.id,name:s.name,sequence:s.sequence,
  arrival:s.arrival,departure:s.departure,lat:s.lat,lon:s.lon,
  platformCode:s.platformCode}));
/** Bounded LIVE candidates; traversal verifies every intervening scheduled trip. */
export async function peerDutyCandidates(peer:PlannedPeer,date:string,now:number,
 source:Source=pidStatic):Promise<DutyTrip[]>{
 if(!peer.tripId||!date)return [];
 const first=await source.getTripResolved(peer.tripId,date);
 if(!first||first.id!==peer.tripId||first.date!==date||!first.blockId)return [
  {tripId:peer.tripId,line:peer.line,startSeconds:peer.departureSeconds}];
 const [rows,routes]=await Promise.all([
  source.getBlockTrips(first.blockId,date),source.getRoutes()
 ]);
 const sorted=[...rows].sort((a,b)=>a.startSeconds-b.startSeconds||a.id.localeCompare(b.id));
 const indices=sorted.flatMap((r,i)=>r.id===first.id&&r.routeId===first.routeId?[i]:[]);
 if(indices.length!==1||routes[first.routeId]?.[0]!==peer.line)return [
  {tripId:peer.tripId,line:peer.line,startSeconds:peer.departureSeconds}];
 const idx=indices[0],seconds=serviceSeconds(date,now);
 let previousStops=await source.getTripStops(first.id,date,first.routeId);
 const endTime=(stops:PidTripStop[])=>{
  const raw=stops.at(-1)?.departure||stops.at(-1)?.arrival||'';
  const m=/^(\d{1,3}):(\d{2}):(\d{2})$/.exec(raw);
  return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):undefined;
 };
 const verified:DutyTrip[]=[{tripId:first.id,line:peer.line,
  startSeconds:sorted[idx].startSeconds,
  endSeconds:previousStops?.length?endTime(previousStops):undefined,
  terminalStopId:previousStops?.at(-1)?.id}];
 if(!previousStops?.length||seconds===null)return verified;
 // Do not take a later trip past a missing/ambiguous intermediate handoff.
 for(let i=idx+1;i<sorted.length;i++){
  const entry=sorted[i],prior=sorted[i-1];
  if(entry.startSeconds<=prior.startSeconds||entry.startSeconds>seconds+1200)break;
  if(i+1<sorted.length&&sorted[i+1].startSeconds===entry.startSeconds)break;
  const next=await source.getTripResolved(entry.id,date,entry.routeId);
  if(!next||next.id!==entry.id||next.routeId!==entry.routeId||
   next.blockId!==first.blockId||next.date!==date)break;
  const nextStops=await source.getTripStops(next.id,date,next.routeId);
  if(!nextStops?.length||!validBlockBoundary(mapped(previousStops),mapped(nextStops)))break;
  const line=routes[entry.routeId]?.[0]??'';
  if(!line)break;
  verified.push({tripId:entry.id,line,startSeconds:entry.startSeconds,
   endSeconds:endTime(nextStops),terminalStopId:nextStops.at(-1)?.id});
  previousStops=nextStops;
 }
 // Current trip and the immediately adjacent one: never scan an entire all-day block.
 const started=verified.filter(v=>v.startSeconds<=seconds+120);
 const edge=verified.find(v=>v.startSeconds>seconds+120);
 return [...started.slice(-2),...(edge?[edge]:[])];
}
