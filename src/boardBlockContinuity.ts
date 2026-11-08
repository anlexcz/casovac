/** Deduplicate terminal arrival -> departure in one verified GTFS block.
 * Each event must be on the requested physical boarding edge, be immediately
 * adjacent in the block, and hand off at that terminal in <=3 minutes.
 * Never merge merely because two trip IDs share a block ID.
 */
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine,PidTripStop,PidTrip} from './pidStatic.ts';
import type {DepartureBoard} from './stopNeighbourBoard.ts';

type Source=Pick<PidStaticEngine,'getTripResolved'|'getTripStops'|'getBlockTrips'>;
export type BoardContinuation={incomingTripId:string;incomingLine:string;
 incomingArrivalSeconds:number;outgoingTripId:string;outgoingLine:string;
 outgoingDepartureSeconds:number;blockId:string};
const seconds=(time:string):number|null=>{
 const m=/^(\d{1,3}):(\d{2}):(\d{2})$/.exec(time);
 return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):null;
};
type TripData={trip:PidTrip;stops:PidTripStop[];line:string;id:string};
export async function findBoardContinuations(
 board:DepartureBoard,date:string,ownSeconds:number,source:Source=pidStatic
):Promise<Map<string,BoardContinuation>>{
 const output=new Map<string,BoardContinuation>();
 const physical=new Set(board.physicalStopIds??[]);
 if(!physical.size||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return output;
 const candidates=[...new Map((board.departures??[])
  .filter(row=>!!row.trip?.id&&!!row.stop?.id&&physical.has(row.stop.id)&&
   typeof row.scheduledSeconds==='number'&&
   Math.abs(row.scheduledSeconds-ownSeconds)<=360)
  .map(row=>[row.trip!.id!,row])).values()].slice(0,48);
 if(candidates.length<2)return output;
 const found=await Promise.all(candidates.map(async row=>{
  try{
   const id=row.trip!.id!,trip=await source.getTripResolved(id,date);
   if(!trip||trip.id!==id||trip.date!==date||!trip.blockId)return null;
   const stops=await source.getTripStops(id,date,trip.routeId);
   if(!stops||stops.length<2)return null;
   return {trip,stops,line:row.route?.short_name??'',id} as TripData;
  }catch{return null;}
 }));
 const groups=new Map<string,TripData[]>();
 for(const data of found){
  if(!data||!data.line)continue;
  groups.set(data.trip.blockId,[...(groups.get(data.trip.blockId)??[]),data]);
 }
 for(const [blockId,items] of groups){
  if(items.length<2)continue;
  let indexed:Awaited<ReturnType<Source['getBlockTrips']>>;
  try{indexed=await source.getBlockTrips(blockId,date);}catch{continue;}
  const sorted=[...indexed].sort((a,b)=>a.startSeconds-b.startSeconds||a.id.localeCompare(b.id));
  const byId=new Map(items.map(item=>[item.id,item]));
  for(let i=0;i<sorted.length-1;i++){
   const first=sorted[i],second=sorted[i+1];
   const incoming=byId.get(first.id),outgoing=byId.get(second.id);
   if(!incoming||!outgoing||first.startSeconds>=second.startSeconds)continue;
   if(i>0&&sorted[i-1].startSeconds===first.startSeconds||
      i+2<sorted.length&&sorted[i+2].startSeconds===second.startSeconds)continue;
   const end=incoming.stops.at(-1)!,start=outgoing.stops[0];
   // The two boundary stop IDs must both have been verified as belonging
   // to the exact same physical platform by the PID boarding-edge index.
   if(!physical.has(end.id)||!physical.has(start.id))continue;
   const arrival=seconds(end.arrival||end.departure);
   const departure=seconds(start.departure||start.arrival);
   if(arrival===null||departure===null||departure-arrival<0||
      departure-arrival>180)continue;
   const incomingCount=incoming.stops.filter(s=>s.id===end.id).length;
   const outgoingCount=outgoing.stops.filter(s=>s.id===start.id).length;
   if(incomingCount!==1||outgoingCount!==1)continue;
   if(output.has(outgoing.id)||[...output.values()].some(v=>v.incomingTripId===incoming.id))continue;
   output.set(outgoing.id,{incomingTripId:incoming.id,incomingLine:incoming.line,
    incomingArrivalSeconds:arrival,outgoingTripId:outgoing.id,
    outgoingLine:outgoing.line,outgoingDepartureSeconds:departure,blockId});
  }
 }
 return output;
}
