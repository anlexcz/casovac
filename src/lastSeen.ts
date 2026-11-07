import {serviceKey} from './trackedService.ts';
import type {TrackedService} from './trackedService.ts';
export type LastSeen={
 line:string;order:string;vehicle:string;tripId:string;lastSeenAt:number;
 lastPositionAt:number|null;lon:number|null;lat:number|null;
 lastStop:string;nextStop:string;state:string;route:string;
};
const key=(line:string,order:string)=>'casovac:last-vehicle:v1:'+line+'/'+order;
export function readLastSeen(line:string,order:string):LastSeen|null{
 try{
  const s=localStorage.getItem(key(line,order));
  if(!s)return null;
  const value:LastSeen=JSON.parse(s);
  return value&&value.line===line&&value.order===order&&
   typeof value.lastSeenAt==='number'&&Date.now()-value.lastSeenAt<6*3600000?value:null;
 }catch{return null;}
}
export function saveLastSeen(value:LastSeen){
 try{localStorage.setItem(key(value.line,value.order),JSON.stringify(value));}catch{/* no persistent storage */}
}
export function extractRecordedVehicle(session:unknown,line:string,order:string):LastSeen|null{
 if(!session||typeof session!=='object')return null;
 const data=session as {target?:{line?:string;order?:string};events?:Array<{kind?:string;receivedAtMs?:number;data?:{vehicle?:unknown}}>};
 if(data.target?.line!==line||data.target.order!==order||!Array.isArray(data.events))return null;
 for(let i=data.events.length-1;i>=0;i--){
  const e=data.events[i],f=e?.data?.vehicle;
  if(e.kind!=='api'||!f||typeof f!=='object')continue;
  const feature=f as {properties?:Record<string,unknown>;geometry?:{coordinates?:unknown}};
  const trip=feature.properties?.trip as Record<string,unknown>|undefined;
  const gtfs=trip?.gtfs as Record<string,unknown>|undefined;
  const position=feature.properties?.last_position as Record<string,unknown>|undefined;
  const last=position?.last_stop as Record<string,unknown>|undefined;
  const next=position?.next_stop as Record<string,unknown>|undefined;
  const coords=feature.geometry?.coordinates;
  const vehicle=String(trip?.vehicle_registration_number??'');
  if(!vehicle)continue;
  const c=Array.isArray(coords)&&coords.length>=2?coords:null;
  return {line,order,vehicle,tripId:String(gtfs?.trip_id??trip?.trip_id??''),
   lastSeenAt:Number(e.receivedAtMs)||0,lastPositionAt:null,
   lon:c&&Number.isFinite(Number(c[0]))?Number(c[0]):null,
   lat:c&&Number.isFinite(Number(c[1]))?Number(c[1]):null,
   lastStop:String(last?.name??''),nextStop:String(next?.name??''),
   state:String(position?.state_position??''),route:String(gtfs?.route_short_name??line)};
 }
 return null;
}

/** Supplemental identity-indexed observation. Legacy per-current-route
 * snapshots are retained for the live tracker and older sessions.
 */
const serviceStorageKey=(service:TrackedService)=>{const key=serviceKey(service);return key?'casovac:last-core-vehicle:v1:'+key:null;};
export function readLastSeenForService(service:TrackedService):LastSeen|null{
 const key=serviceStorageKey(service);
 if(!key)return null;
 try{
  const raw=localStorage.getItem(key);
  if(!raw)return null;
  const value=JSON.parse(raw) as LastSeen;
  return value&&typeof value.lastSeenAt==='number'&&
   Date.now()-value.lastSeenAt<6*3600000?value:null;
 }catch{return null;}
}
export function saveLastSeenForService(service:TrackedService,value:LastSeen){
 const key=serviceStorageKey(service);
 if(!key||!service.verified)return;
 try{localStorage.setItem(key,JSON.stringify(value));}catch{/* optional cache */}
}
