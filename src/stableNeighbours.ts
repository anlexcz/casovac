import type {NeighbourRow} from './stopNeighbours.ts';

export type StableNeighbour = {
 row:NeighbourRow; missingCycles:number; lastSeen:number; exiting:boolean;
};
export type StableNeighbourState = {
 entries:StableNeighbour[]; lastCompleteRevision:number;
};
/**
 * Live polls can be incomplete while Golemio's routes arrive in batches.
 * Never remove a row on a partial refresh; require two separate completed
 * snapshots and at least 20 seconds since the last confirmed sighting.
 * Updates to an existing trip replace its fields without changing its identity.
 */
export function reconcileNeighbours(
 previous:StableNeighbourState,
 incoming:NeighbourRow[],
 revision:number,
 complete:boolean,
 now:number
):StableNeighbourState{
 const byTrip=new Map(incoming.map(row=>[row.tripId,row]));
 const seen=new Set<string>();
 const countMissing=complete&&revision>previous.lastCompleteRevision;
 const entries:StableNeighbour[]=[];
 for(const entry of previous.entries){
  const current=byTrip.get(entry.row.tripId);
  if(current){
   entries.push({row:current,missingCycles:0,lastSeen:now,exiting:false});
   seen.add(current.tripId);
  }else if(!entry.exiting){
   const missingCycles=entry.missingCycles+(countMissing?1:0);
   entries.push({...entry,missingCycles,
    exiting:missingCycles>=2&&now-entry.lastSeen>=20000});
  }else entries.push(entry);
 }
 for(const row of incoming){
  if(!seen.has(row.tripId)&&!entries.some(e=>e.row.tripId===row.tripId))
   entries.push({row,missingCycles:0,lastSeen:now,exiting:false});
 }
 entries.sort((a,b)=>a.row.scheduledSeconds-b.row.scheduledSeconds||
  a.row.line.localeCompare(b.row.line,'cs')||a.row.order.localeCompare(b.row.order,'cs'));
 return {entries,lastCompleteRevision:countMissing?revision:previous.lastCompleteRevision};
}
export function emptyStableNeighbours():StableNeighbourState{
 return {entries:[],lastCompleteRevision:0};
}
