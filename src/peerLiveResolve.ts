/** Resolve exactly one LIVE trip from an independently validated GTFS duty.
 * A block is PLAN continuity. Without a previously observed vehicle anchor
 * the successor's LIVE position is usable but physical identity is provisional.
 */
import {selectedTripId,routeOf,vehicleId} from './featureUtils.ts';
import {freshTripPosition} from './plannedPeerPosition.ts';
import {observationTimestamp} from './remoteTracking.ts';
import type {Feature} from './featureUtils.ts';
import type {DutyTrip} from './peerDutyContinuity.ts';
export type PeerLiveResolution={
 feature:Feature|null;tripId:string;
 confidence:'anchored'|'provisional'|'original'|'none';
 reason:'found'|'missing'|'stale'|'ambiguous'|'vehicle-mismatch';
};
export function selectDutyLive(args:{
 originalTripId:string;candidates:DutyTrip[];
 features:Feature[];now:number;anchor?:string|null;
}):PeerLiveResolution{
 const {originalTripId,candidates,features,now,anchor}=args;
 let reason:'missing'|'stale'|'ambiguous'|'vehicle-mismatch'='missing';
 for(const candidate of [...candidates].reverse()){
  const matches=features.filter(f=>selectedTripId(f)===candidate.tripId&&
   routeOf(f)===candidate.line);
  if(!matches.length)continue;
  // A route snapshot and an exact-trip lookup often contain the SAME vehicle.
  // Duplicated copies are not ambiguous. Prefer the newest actual measurement,
  // but reject two different cars reporting the same trip/time.
  const latest=Math.max(...matches.map(f=>observationTimestamp(f)??-Infinity));
  const current=matches.filter(f=>(observationTimestamp(f)??-Infinity)===latest);
  const vehicles=[...new Set(current.map(vehicleId))];
  if(vehicles.length!==1){reason='ambiguous';continue;}
  const feature=current[0],car=vehicleId(feature);
  if(!freshTripPosition(feature,now)||car==='—'){reason='stale';continue;}
  if(candidate.tripId!==originalTripId&&anchor&&car!==anchor){
   reason='vehicle-mismatch';continue;
  }
  return {feature,tripId:candidate.tripId,reason:'found',
   confidence:candidate.tripId===originalTripId?'original':
    anchor?'anchored':'provisional'};
 }
 return {feature:null,tripId:'',confidence:'none',reason};
}
