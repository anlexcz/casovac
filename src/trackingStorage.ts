import {parseTrackedService,unverifiedService,operatingDate} from './trackedService.ts';
import type {TrackedService} from './trackedService.ts';

// Keep the persistence format and TTL compatible with existing installations.
export const TOKEN_KEY='casovac:golemio-token:v1';
export const ROUTE_KEY='casovac:last-order:v1';
export const ACTIVE_KEY='casovac:active-order:v1';
export const ACTIVE_TTL=4*60*60*1000;
export const recentTracking=():[string,string]|null=>{try{
 const raw=localStorage.getItem(ACTIVE_KEY);if(!raw)return null;
 const v=JSON.parse(raw) as {line?:string;order?:string;expires?:number};
 if(!v?.expires||v.expires<Date.now()||!/^\d{1,3}$/.test(v.line??'')||!/^\d{1,4}$/.test(v.order??'')){
  localStorage.removeItem(ACTIVE_KEY);return null;
 }
 return [v.line!,v.order!];
 }catch{return null;}};
export const stored=(key:string):string=>{try{return localStorage.getItem(key)??'';}catch{return '';}};
export const save=(key:string,value:string)=>{try{if(value)localStorage.setItem(key,value);else localStorage.removeItem(key);return true;}catch{return false;}};

/** v2 is additive. Existing active-order v1 remains the live tracker until D. */
export const ACTIVE_SERVICE_KEY='casovac:tracked-service:v2';
type StoredService={version:2;expires:number;service:TrackedService};
export function decodeStoredService(raw:string,now:number):TrackedService|null{
 try{
  const value=JSON.parse(raw) as StoredService;
  if(value?.version!==2||typeof value.expires!=='number'||value.expires<=now)return null;
  return parseTrackedService(value.service);
 }catch{return null;}
}
export function readTrackedService(now=Date.now()):TrackedService|null{
 return decodeStoredService(stored(ACTIVE_SERVICE_KEY),now);
}
export function storeTrackedService(service:TrackedService|null,expires=Date.now()+ACTIVE_TTL){
 return save(ACTIVE_SERVICE_KEY,service?JSON.stringify({version:2,expires,service}):'');
}
/** Old saved line/order still works. Its core identity remains UNKNOWN until
 * Golemio supplies an exact vehicle observation; never guess an origin.
 */
export function restoreTrackedService(now=Date.now()):TrackedService|null{
 const lineOrder=recentTracking();
 if(!lineOrder)return null;
 const existing=readTrackedService(now);
 if(existing&&existing.currentRoute===lineOrder[0]&&existing.sequenceId===lineOrder[1])
  return existing;
 return unverifiedService(lineOrder[0],lineOrder[1],operatingDate(now));
}
