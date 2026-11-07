import type {NeighbourRow} from './stopNeighbours.ts';

export type StableNeighbour = {
 row:NeighbourRow; missingCycles:number; lastSeen:number; exiting:boolean;
};
export type StableNeighbourState = {
 entries:StableNeighbour[]; lastCompleteRevision:number;
};
/**
 * A neighbour that was once verified for this platform remains in the
 * timetable until the platform session ends. Vehiclepositions reports
 * only vehicles still approaching; they must not erase scheduled peers
 * which have already passed the platform. New rows may appear and known
 * rows receive current telemetry without changing their fixed position.
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
  if(!current)return {...entry,missingCycles:entry.missingCycles+(complete&&revision>previous.lastCompleteRevision?1:0),exiting:false};
  return {row:current,missingCycles:0,lastSeen:now,exiting:false};
 });
 const previousIds=new Set(previous.entries.map(entry=>entry.row.tripId));
 for(const row of incoming){
  if(!previousIds.has(row.tripId)){
   entries.push({row,missingCycles:0,lastSeen:now,exiting:false});
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
