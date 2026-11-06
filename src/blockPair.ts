import {sameTransitionStop} from './terminalMatch.ts';
import {parseStops} from './tripData.ts';
import type {Stop} from './tripData';
import type {ChainTrip} from './chainDiagnostics';

// A GTFS block identifies a planned through service, not its operating order.
// Runtime vehicle observations only provide candidate IDs; GTFS confirms the pair.
export type OnlineTripDetail={
 trip_id?:string;block_id?:string|null;stop_times?:unknown;route?:{route_short_name?:string};
};
export type BlockPair={
 partner:ChainTrip;role:'first'|'second';blockId:string;
 firstId:string;secondId:string;reason:string;
};
const serviceClock=(value:string):number|null=>{
 const match=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
 return match?Number(match[1])*3600+Number(match[2])*60+Number(match[3]??0):null;
};
export function validBlockBoundary(first:Stop[],second:Stop[]):boolean{
 if(first.length<2||second.length<2)return false;
 const last=first[first.length-1],start=second[0];
 if(!sameTransitionStop(last,start))return false;
 const arrival=serviceClock(last.arrival||last.departure);
 const departure=serviceClock(start.departure||start.arrival);
 if(arrival===null||departure===null)return false;
 // GTFS times may wrap at midnight and waiting at a terminal is legitimate.
 return [departure-arrival,departure+86400-arrival].some(diff=>diff>=-180);
}
export function findVerifiedBlockPair(
 current:{tripId:string;line:string;start:unknown;detail:OnlineTripDetail},
 candidates:Array<{trip:ChainTrip;detail:OnlineTripDetail}>
):BlockPair|null{
 const block=current.detail.block_id?.trim();
 if(!block||current.detail.trip_id!==current.tripId)return null;
 const oldStops=parseStops(current.detail);
 const options:BlockPair[]=[];
 for(const {trip,detail} of candidates){
  if(!trip.tripId||trip.tripId===current.tripId||detail.trip_id!==trip.tripId||
   !detail.block_id||detail.block_id!==block||trip.line===current.line)continue;
  const nextStops=parseStops(detail);
  const currentFirst=validBlockBoundary(oldStops,nextStops);
  const otherFirst=validBlockBoundary(nextStops,oldStops);
  if(currentFirst===otherFirst)continue; // neither direction, or ambiguous
  const role=currentFirst?'first':'second';
  const a=currentFirst?current.tripId:trip.tripId;
  const b=currentFirst?trip.tripId:current.tripId;
  options.push({partner:trip,role,blockId:block,firstId:a,secondId:b,
   reason:'Shodné block_id a společná přechodová zastávka v online GTFS.'});
 }
 // Reject more than one distinct and equally verified partner; never guess.
 return options.length===1?options[0]:null;
}
