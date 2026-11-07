import {normalize,orderOf,originRouteOf,routeOf,selectedTripId,vehicleId,stateOfFeature,path} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import type {TrackedService} from './trackedService.ts';
import {tripStart} from './tripSelection.ts';

export type CoreCandidate={
 feature:Feature;route:string;order:string;vehicle:string;tripId:string;
 state:string;observedAt:number;
};
export type CoreDecision={
 candidate:CoreCandidate|null;
 reason:'unverified'|'no-match'|'no-live'|'ambiguous'|'stale'|'active';
 matchedTrips:number;activeVehicles:number;
};
const observation=(f:Feature):number=>{
 const raw=path(f,'properties.last_position.origin_timestamp');
 const n=typeof raw==='string'?Date.parse(raw):NaN;
 return Number.isFinite(n)?n:0;
};
const active=(f:Feature)=>['on_track','at_stop'].includes(stateOfFeature(f));
/** Only current, fresh, unambiguous telemetry of the exact origin+sequence
 * can trigger cross-route handoff. The registration is never an identity key.
 * before_track / after_track records can not move the followed duty.
 */
export function decideCoreDuty(
 features:Feature[],service:TrackedService|null,now:number
):CoreDecision{
 if(!service?.verified||!service.originRoute)return {candidate:null,reason:'unverified',matchedTrips:0,activeVehicles:0};
 const matching=features.filter(f=>
  originRouteOf(f)===service.originRoute&&
  normalize(orderOf(f))===service.sequenceId&&
  /^\d{1,3}$/.test(routeOf(f))&&
  selectedTripId(f)!=='—');
 if(!matching.length)return {candidate:null,reason:'no-match',matchedTrips:0,activeVehicles:0};
 const live=matching.filter(active);
 if(!live.length)return {candidate:null,reason:'no-live',matchedTrips:matching.length,activeVehicles:0};
 const byCar=new Map<string,Feature[]>();
 for(const item of live){
  const car=vehicleId(item);
  if(!car||car==='—')continue;
  const group=byCar.get(car)??[];
  group.push(item);
  byCar.set(car,group);
 }
 if(!byCar.size)return {candidate:null,reason:'no-live',matchedTrips:matching.length,activeVehicles:0};
 const ranked=[...byCar].map(([car,rows])=>{
  const ordered=[...rows].sort((a,b)=>observation(b)-observation(a)||
   (tripStart(b)??0)-(tripStart(a)??0));
  return {car,feature:ordered[0],time:observation(ordered[0])};
 }).sort((a,b)=>b.time-a.time);
 const top=ranked[0];
 if(top.time<=now-90000||top.time>now+10000)
  return {candidate:null,reason:'stale',matchedTrips:matching.length,activeVehicles:ranked.length};
 if(ranked.length>1&&top.time-ranked[1].time<30000)
  return {candidate:null,reason:'ambiguous',matchedTrips:matching.length,activeVehicles:ranked.length};
 const f=top.feature;
 return {candidate:{
  feature:f,route:normalize(routeOf(f)),order:normalize(orderOf(f)),
  vehicle:top.car,tripId:selectedTripId(f),state:stateOfFeature(f),observedAt:top.time
 },reason:'active',matchedTrips:matching.length,activeVehicles:ranked.length};
}
/** Local route data can be safely shown only when it belongs to this core. */
export function filterCoreFeatures(features:Feature[],service:TrackedService|null):Feature[]{
 if(!service?.verified)return features;
 return features.filter(f=>originRouteOf(f)===service.originRoute&&
  normalize(orderOf(f))===service.sequenceId);
}
