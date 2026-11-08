/** Bounded in-memory last-confirmed LIVE observations shared by neighbour panels
 * and planned headways. Failed HTTP calls and empty responses NEVER erase data.
 * A retained feature keeps its original origin_timestamp and cannot become LIVE
 * merely because an API request completed successfully.
 */
import {observationTimestamp} from './remoteTracking.ts';
import {selectedTripId,vehicleId} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';

export type ObservationQuality='fresh'|'last-known'|'expired'|'unknown';
export type VehicleObservation={tripId:string;serviceDate:string;vehicle:string;
 observedAt:number;receivedAt:number;feature:Feature};
export const FRESH_OBSERVATION_MS=90_000;
export const RETAIN_OBSERVATION_MS=180_000;
const MAX_OBSERVATIONS=450;
export class VehicleObservationStore{
 private readonly values=new Map<string,VehicleObservation>();
 private key(date:string,id:string){return date+'|'+id;}
 observe(date:string,feature:Feature,receivedAt=Date.now()):boolean{
  const tripId=selectedTripId(feature),observedAt=observationTimestamp(feature);
  if(!date||tripId==='—'||observedAt===null||observedAt>receivedAt+10_000||
   receivedAt-observedAt>RETAIN_OBSERVATION_MS)return false;
  const key=this.key(date,tripId),previous=this.values.get(key);
  if(previous&&previous.observedAt>observedAt)return false;
  if(previous&&previous.observedAt===observedAt){
   // Refreshing the same observation is not a new measurement.
   return false;
  }
  this.values.delete(key);
  this.values.set(key,{tripId,serviceDate:date,vehicle:vehicleId(feature),
   observedAt,receivedAt,feature});
  while(this.values.size>MAX_OBSERVATIONS)
   this.values.delete(this.values.keys().next().value!);
  return true;
 }
 observeMany(date:string,features:Feature[],now=Date.now()):void{
  for(const feature of features)this.observe(date,feature,now);
 }
 get(date:string,id:string):VehicleObservation|null{
  return this.values.get(this.key(date,id))??null;
 }
 quality(date:string,id:string,now=Date.now()):ObservationQuality{
  const item=this.get(date,id);
  if(!item)return 'unknown';
  const age=now-item.observedAt;
  if(age<0||age>RETAIN_OBSERVATION_MS)return 'expired';
  return age<=FRESH_OBSERVATION_MS?'fresh':'last-known';
 }
 /** A last-known object can be shown as identity, never as fresh LIVE gap. */
 retained(date:string,id:string,now=Date.now()):Feature|null{
  const quality=this.quality(date,id,now);
  const observed=this.get(date,id);
  return observed&&(quality==='fresh'||quality==='last-known')?observed.feature:null;
 }
 clear():void{this.values.clear();}
}
export const vehicleObservations=new VehicleObservationStore();
