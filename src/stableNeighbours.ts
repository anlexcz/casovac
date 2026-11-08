import type {NeighbourRow} from './stopNeighbours.ts';

/** Keep last confirmed neighbour telemetry over three missed minute refreshes.
 * Retention is not a claim of fresh LIVE position.
 */
export const NEIGHBOUR_VISUAL_RETAIN_MS=180_000;
export type StableNeighbour = {
 row:NeighbourRow; missingCycles:number; lastSeen:number; lastLiveAt:number|null; exiting:boolean;
};
export type StableNeighbourState = {
 entries:StableNeighbour[]; lastCompleteRevision:number;
};
const samePlannedIdentity=(a:NeighbourRow,b:NeighbourRow)=>
 a.tripId===b.tripId&&a.line===b.line&&
 a.scheduledSeconds===b.scheduledSeconds&&a.relative===b.relative;
const liveWithinRetention=(item:StableNeighbour,now:number)=>
 item.lastLiveAt!==null&&now-item.lastLiveAt<NEIGHBOUR_VISUAL_RETAIN_MS;

/** One missed/partial response must not reset a confirmed colour or vehicle.
 * A real LIVE change replaces the old delay immediately. Unknown new telemetry
 * retains the previous measurement only within the explicitly bounded cache.
 * Rows remain in the GTFS timetable after LIVE expires, but without LIVE
 * delay/colour until another confirmed measurement arrives.
 */
export function reconcileNeighbours(
 previous:StableNeighbourState,
 incoming:NeighbourRow[],
 revision:number,
 complete:boolean,
 now:number
):StableNeighbourState{
 const byTrip=new Map(incoming.map(row=>[row.tripId,row]));
 const entries=previous.entries.map(entry=>{
  const current=byTrip.get(entry.row.tripId);
  const missed=complete&&revision>previous.lastCompleteRevision;
  if(!current){
   const retain=liveWithinRetention(entry,now);
   return {...entry,row:retain?entry.row:{...entry.row,delay:null},
    missingCycles:entry.missingCycles+(missed?1:0),exiting:false};
  }
  if(!samePlannedIdentity(entry.row,current)){
   return {row:current,missingCycles:0,lastSeen:now,
    lastLiveAt:current.delay!==null?now:null,exiting:false};
  }
  if(current.delay!==null){
   return {row:{...current,
     order:current.order==='?'&&entry.row.order!=='?'?entry.row.order:current.order,
     vehicle:current.vehicle||entry.row.vehicle},
    missingCycles:0,lastSeen:now,lastLiveAt:now,exiting:false};
  }
  const retain=liveWithinRetention(entry,now);
  return {row:{...current,
   delay:retain?entry.row.delay:null,
   order:current.order==='?'&&entry.row.order!=='?'?entry.row.order:current.order,
   vehicle:current.vehicle||entry.row.vehicle},
   missingCycles:0,lastSeen:now,lastLiveAt:entry.lastLiveAt,exiting:false};
 });
 const previousIds=new Set(previous.entries.map(entry=>entry.row.tripId));
 for(const row of incoming){
  if(!previousIds.has(row.tripId)){
   entries.push({row,missingCycles:0,lastSeen:now,
    lastLiveAt:row.delay!==null?now:null,exiting:false});
   previousIds.add(row.tripId);
  }
 }
 entries.sort((a,b)=>a.row.scheduledSeconds-b.row.scheduledSeconds||
  a.row.line.localeCompare(b.row.line,'cs')||a.row.order.localeCompare(b.row.order,'cs'));
 return {entries,lastCompleteRevision:complete&&revision>previous.lastCompleteRevision?
  revision:previous.lastCompleteRevision};
}
export function emptyStableNeighbours():StableNeighbourState{
 return {entries:[],lastCompleteRevision:0};
}
