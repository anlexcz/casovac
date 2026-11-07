import {normalize,orderOf,path,routeOf,selectedTripId,vehicleId} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';

/** An operating duty is not a physical tram or an individual GTFS trip.
 * Automatic cross-route discovery is deliberately NOT part of this module.
 */
export type TrackedService={
 serviceDate:string;originRoute:string;sequenceId:string;
 currentRoute:string;currentTripId:string|null;vehicleId:string|null;
 verified:boolean;
};
const numeric=(v:unknown,max:number):string|null=>{
 const value=String(v??'').trim();
 return new RegExp('^[0-9]{1,'+max+'}$').test(value)?normalize(value):null;
};
const localDate=(timestamp:number):string=>
 new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',
  month:'2-digit',day:'2-digit'}).format(new Date(timestamp));
export const operatingDate=(timestamp:number):string=>localDate(timestamp);

/** Only live Golemio trip properties may verify the origin route. */
export function serviceFromFeature(feature:Feature,serviceDate:string):TrackedService|null{
 const currentRoute=numeric(routeOf(feature),3);
 const sequenceId=numeric(orderOf(feature),4);
 const originRoute=numeric(path(feature,'properties.trip.origin_route_name'),3);
 if(!currentRoute||!sequenceId||!originRoute||!validDate(serviceDate))return null;
 const tripId=selectedTripId(feature),vehicle=vehicleId(feature);
 return {serviceDate,originRoute,sequenceId,currentRoute,
  currentTripId:tripId==='—'?null:tripId,
  vehicleId:vehicle==='—'?null:vehicle,verified:true};
}
export function unverifiedService(currentRoute:string,sequenceId:string,serviceDate:string):TrackedService|null{
 const line=numeric(currentRoute,3),order=numeric(sequenceId,4);
 if(!line||!order||!validDate(serviceDate))return null;
 // Unknown is distinct from matching-current. Never invent origin_route_name.
 return {serviceDate,originRoute:'',sequenceId:order,currentRoute:line,
  currentTripId:null,vehicleId:null,verified:false};
}
const validDate=(value:unknown):value is string=>
 typeof value==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)&&
 Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
 new Date(value+'T00:00:00Z').toISOString().startsWith(value);
export const serviceKey=(s:TrackedService):string|null=>
 s.verified&&s.originRoute?s.serviceDate+'|'+s.originRoute+'/'+s.sequenceId:null;
export const matchesCurrent=(service:TrackedService,line:string,order:string)=>
 service.currentRoute===normalize(line)&&service.sequenceId===normalize(order);

/** Preserve the original core identity if new telemetry differs.
 * This prevents corrupting the selected duty after a stale/foreign response.
 * Same-core vehicle replacements and trip advances are legitimate updates.
 */
export function observeService(current:TrackedService|null,feature:Feature,
 serviceDate:string,expectedLine:string,expectedOrder:string):TrackedService|null{
 const incoming=serviceFromFeature(feature,serviceDate);
 if(!incoming||incoming.currentRoute!==normalize(expectedLine)||
  incoming.sequenceId!==normalize(expectedOrder))return current;
 if(!current||!matchesCurrent(current,expectedLine,expectedOrder))return incoming;
 if(current.serviceDate!==serviceDate)return current;
 if(current.verified&&serviceKey(current)!==serviceKey(incoming))return current;
 return incoming;
}
/** The core identity survives an already-verified GTFS handoff; otherwise
 * retain it only as an unresolved historic observation (never relabel it).
 */
export function withCurrentRoute(service:TrackedService|null,line:string,order:string):TrackedService|null{
 if(!service||normalize(order)!==service.sequenceId)return null;
 const route=numeric(line,3);
 return route?{...service,currentRoute:route,currentTripId:null,vehicleId:null}:null;
}
export function parseTrackedService(value:unknown):TrackedService|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>;
 const date=v.serviceDate,origin=numeric(v.originRoute,3);
 const order=numeric(v.sequenceId,4),route=numeric(v.currentRoute,3);
 if(!validDate(date)||!order||!route)return null;
 if(v.verified===true&&!origin)return null;
 const trip=v.currentTripId,car=v.vehicleId;
 return {serviceDate:date,originRoute:origin??'',sequenceId:order,currentRoute:route,
  currentTripId:typeof trip==='string'&&trip.length<=160?trip:null,
  vehicleId:typeof car==='string'&&car.length<=32?car:null,verified:v.verified===true&&!!origin};
}
