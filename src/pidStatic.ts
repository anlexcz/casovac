/** Časovač 2.0: read-only PID GTFS client (phase 1B).
 * Independent from Golemio. Never silently infers a stop, service date or block.
 * Phase 1B deliberately does not replace the live timer's legacy data flow.
 */
import {IndexedPidStore} from './pidPersistentCache.ts';
import type {PidStore} from './pidPersistentCache.ts';

export type PidStopRow={n:string;a:number;o:number;p:string;l:string;parent:string};
export type PidRouteRow=[string,string,string,string,string,string];
export type PidStopTime=[string,number,number,number,string];
export type PidTripRow=[string,string,string,string,string,string,PidStopTime[]];
export type PidBlockRow=[number,string,string];
export type PidDepartureRow=[number,string,string,number];
export type PidPlatformRow=[string,string,number,number,string,string,string,string[],string];
export type PidGroupRow=[string,string,string,number,number,string[]];
export type PidShapePoint=[number,number];
export type PidDayInfo={trips:number;departures:number;routes:number;platforms:number;buckets:number;blocks:number;available:boolean};
export type PidManifest={
 schema:string;generatedAt:string;referenceDay:string;timezone:string;
 days:Record<string,PidDayInfo>;feed:{gtfsUrl:string;stopsUrl:string;startDate:string;endDate:string;stopsGeneratedAt:string|null};
 counts:Record<string,number>;format:Record<string,string>;checksums?:Record<string,string>;
};
export type PidTrip={id:string;date:string;routeId:string;serviceId:string;
 headsign:string;directionId:string;blockId:string;shapeId:string;
 shortName:string;stopTimes:PidStopTime[]};
export type PidDeparture={stopId:string;date:string;departureSeconds:number;tripId:string;routeId:string;stopSequence:number};
export type PidBlockTrip={id:string;date:string;startSeconds:number;routeId:string};
export type PidPhysicalPlatform={id:string;groupId:string;platform:string;lat:number;lon:number;
 zone:string;mode:string;wheelchair:string;gtfsIds:string[];alternateName:string};
export type PidTripStop={id:string;name:string;sequence:number;arrival:string;departure:string;
 lat:number|null;lon:number|null;platformCode:string;physicalId:string|null};
export class PidStaticError extends Error{
 readonly reason:'network'|'invalid'|'unavailable'|'not-found'|'unsupported';
 constructor(reason:'network'|'invalid'|'unavailable'|'not-found'|'unsupported',message:string){
  super(message);this.reason=reason;this.name='PidStaticError';
 }
}
function object(value:unknown):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value);
}
function isDay(value:string):boolean{return /^\d{4}-\d{2}-\d{2}$/.test(value);}
export function formatGtfsSeconds(value:number):string{
 if(!Number.isSafeInteger(value)||value<0)throw new PidStaticError('invalid','Invalid GTFS time');
 const h=Math.floor(value/3600),m=Math.floor(value%3600/60),s=value%60;
 return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
export function pidTripStopRows(trip:PidTrip,stops:Record<string,PidStopRow>,
 physicalIds:Record<string,string>={}):PidTripStop[]{
 return trip.stopTimes.map(([id,arrival,departure,sequence])=>{
  const s=stops[id];
  if(!s)throw new PidStaticError('invalid','Unknown GTFS stop in trip '+trip.id);
  return {id,name:s.n,sequence,arrival:formatGtfsSeconds(arrival),
   departure:formatGtfsSeconds(departure),lat:s.a,lon:s.o,
   platformCode:s.p,physicalId:physicalIds[id]??null};
 });
}
export function comparePidTripStops(staticStops:PidTripStop[],onlineStops:Array<{id:string;sequence:number;arrival:string;departure:string}>){
 const staticBySeq=new Map(staticStops.map(s=>[s.sequence,s]));
 const onlineBySeq=new Map(onlineStops.map(s=>[s.sequence,s]));
 const mismatches:Array<{sequence:number;staticId:string;onlineId:string;reason:string}>=[];
 for(const seq of new Set([...staticBySeq.keys(),...onlineBySeq.keys()])){
  const local=staticBySeq.get(seq),remote=onlineBySeq.get(seq);
  if(!local||!remote)mismatches.push({sequence:seq,staticId:local?.id??'',onlineId:remote?.id??'',reason:'missing-stop'});
  else if(remote.id&&remote.id!==local.id)mismatches.push({sequence:seq,staticId:local.id,onlineId:remote.id,reason:'stop-id'});
  else {
   for(const key of ['arrival','departure'] as const){
    // Compare only GTFS HH:MM:SS values; Golemio can return timestamps/ISO.
    const online=remote[key];
    if(/^\d{1,2}:\d{2}(?::\d{2})?$/.test(online)&&
     (online.length===5?online+':00':online)!==local[key]){
     mismatches.push({sequence:seq,staticId:local.id,onlineId:remote.id,reason:key});
    }
   }
  }
 }
 return {staticCount:staticStops.length,onlineCount:onlineStops.length,
  compared:onlineStops.length>0,mismatches,match:onlineStops.length>0&&!mismatches.length};
}
function basePath():string{
 // Runtime resolves Vite's base even on GitHub Pages; Node fixture uses '/'.
 const base=typeof import.meta.env?.BASE_URL==='string'?import.meta.env.BASE_URL:'/';
 return base.endsWith('/')?base:base+'/';
}
export function pidServiceDate(timestamp:Date):string{
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(timestamp);
}
const CACHE_LIMIT=24;
type Cached={value:unknown;url:string};
export class PidStaticEngine{
 private manifestPromise:Promise<PidManifest>|null=null;
 private manifestAt=0;
 private version='';
 private manifestSource:'network'|'persisted'|'none'='none';
 private readonly cache=new Map<string,Cached>();
 private readonly pending=new Map<string,Promise<unknown>>();
 private readonly base:string;
 private readonly loader:typeof fetch;
 private readonly persistent:PidStore;
 constructor(base:string=basePath()+'data/pid/v1/',
  loader:typeof fetch=(input,init)=>globalThis.fetch(input,init),
  persistent:PidStore=new IndexedPidStore()){
  this.base=base.endsWith('/')?base:base+'/';
  this.loader=loader;
  this.persistent=persistent;
 }
 /** Explicit freshness, never present a persisted manifest as a live fetch. */
 getDataStatus():{source:'network'|'persisted'|'none';version:string;referenceDay:string|null}{
  return {source:this.manifestSource,version:this.version,
   referenceDay:this.lastManifest?.referenceDay??null};
 }
 private lastManifest:PidManifest|null=null;
 private async request<T>(path:string,version:string):Promise<T>{
  const key=version+'|'+path;
  const existing=this.cache.get(key);
  if(existing){this.cache.delete(key);this.cache.set(key,existing);return existing.value as T;}
  const inFlight=this.pending.get(key);
  if(inFlight)return inFlight as Promise<T>;
  const url=this.base+path+'?v='+encodeURIComponent(version);
  const task=(async()=>{
   const saved=await this.persistent.get(key).catch(()=>null);
   if(object(saved)){
    this.cache.set(key,{value:saved,url});
    while(this.cache.size>CACHE_LIMIT)this.cache.delete(this.cache.keys().next().value!);
    return saved as T;
   }
   let response:Response;
   try{response=await this.loader(url,{cache:'default'});}
   catch(e){throw new PidStaticError('network','PID static request failed: '+(e instanceof Error?e.message:String(e)));}
   if(response.status===404)throw new PidStaticError('not-found','Missing PID shard '+path);
   if(!response.ok)throw new PidStaticError('network','PID shard HTTP '+response.status);
   let value:unknown;
   const expected=this.lastManifest?.generatedAt===version?this.lastManifest?.checksums?.[path]:undefined;
   try{
    if(this.lastManifest?.checksums&&this.lastManifest.generatedAt===version&&!expected)
     throw new PidStaticError('invalid','PID manifest does not list shard '+path);
    if(expected){
     const raw=await response.text();
     if(!globalThis.crypto?.subtle)throw new PidStaticError('unsupported','Cannot verify PID release without Web Crypto');
     const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
     const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
     if(actual!==expected)throw new PidStaticError('invalid','PID release mismatch at '+path);
     value=JSON.parse(raw);
    }else value=await response.json(); // compatibility with phase-1B outputs
   }catch(e){
    if(e instanceof PidStaticError)throw e;
    throw new PidStaticError('invalid','Corrupted PID JSON '+path);
   }
   if(!object(value))throw new PidStaticError('invalid','Unexpected PID JSON '+path);
   this.cache.set(key,{value,url});
   while(this.cache.size>CACHE_LIMIT)this.cache.delete(this.cache.keys().next().value!);
   await this.persistent.put(key,value).catch(()=>{});
   return value as T;
  })();
  this.pending.set(key,task);
  try{return await task;}finally{this.pending.delete(key);}
 }
 async getManifest(force=false):Promise<PidManifest>{
  const now=Date.now();
  if(!force&&this.manifestPromise&&now-this.manifestAt<60_000)return this.manifestPromise;
  const task=(async()=>{
   let fetched:PidManifest|null=null;
   let networkError:unknown=null;
   try{
    const response=await this.loader(this.base+'manifest.json',{cache:'no-store'});
    if(!response.ok)throw new PidStaticError('network','PID manifest HTTP '+response.status);
    let value:unknown;
    try{value=await response.json();}
    catch{throw new PidStaticError('invalid','Invalid PID manifest JSON');}
    fetched=this.validateManifest(value);
   }catch(e){networkError=e;}
   let manifest:PidManifest;
   if(fetched){
    manifest=fetched;
    this.manifestSource='network';
    await this.persistent.put('manifest',manifest).catch(()=>{});
   }else{
    // Do not silently rescue a corrupt/unsupported live manifest.
    if(networkError instanceof PidStaticError&&networkError.reason==='invalid')throw networkError;
    const stored=await this.persistent.get('manifest').catch(()=>null);
    if(!stored&&!this.lastManifest)throw new PidStaticError('network','PID manifest unavailable, no local copy: '+String(networkError));
    manifest=this.validateManifest(stored??this.lastManifest);
    // An old publication is not a valid substitute for a different operating day.
    if(!manifest.days[pidServiceDate(new Date())])
     throw new PidStaticError('unavailable','Offline PID manifest does not cover today');
    this.manifestSource='persisted';
   }
   if(this.version&&this.version!==manifest.generatedAt)this.cache.clear();
   this.version=manifest.generatedAt;
   this.lastManifest=manifest;
   return manifest;
  })();
  this.manifestAt=now;this.manifestPromise=task;
  try{return await task;}catch(e){this.manifestPromise=null;this.manifestSource='none';throw e;}
 }
 private validateManifest(data:unknown):PidManifest{
  if(!object(data)||data.schema!=='casovac-pid-v1'||!isDay(String(data.referenceDay??''))||
     typeof data.generatedAt!=='string'||!object(data.days)||!object(data.counts)||
     data.timezone!=='Europe/Prague'||
     (data.checksums!==undefined&&!object(data.checksums))){
   throw new PidStaticError('invalid','Unsupported/corrupted PID manifest');
  }
  return data as unknown as PidManifest;
 }
 private async day(day:string):Promise<PidManifest>{
  if(!isDay(day))throw new PidStaticError('invalid','Expected service date YYYY-MM-DD');
  const manifest=await this.getManifest();
  const info=manifest.days[day];
  if(!info||!info.available)throw new PidStaticError('unavailable','PID timetable unavailable for '+day);
  return manifest;
 }
 private async shard<T>(path:string):Promise<T>{
  const manifest=await this.getManifest();
  return this.request<T>(path,manifest.generatedAt);
 }
 async getRoutes():Promise<Record<string,PidRouteRow>>{
  return this.shard<Record<string,PidRouteRow>>('routes.json');
 }
 async getGtfsStops():Promise<Record<string,PidStopRow>>{
  return this.shard<Record<string,PidStopRow>>('stops/gtfs.json');
 }
 async getStopMap():Promise<Record<string,string>>{
  return this.shard<Record<string,string>>('stops/gtfs-map.json');
 }
 async getPlatforms():Promise<Record<string,PidPlatformRow>>{
  return this.shard<Record<string,PidPlatformRow>>('stops/platforms.json');
 }
 async getGroups():Promise<Record<string,PidGroupRow>>{
  return this.shard<Record<string,PidGroupRow>>('stops/groups.json');
 }
 async getPhysicalPlatform(stopId:string):Promise<PidPhysicalPlatform|null>{
  const map=await this.getStopMap();
  const id=map[stopId];
  if(!id)return null;
  const item=(await this.getPlatforms())[id];
  if(!item)throw new PidStaticError('invalid','Missing physical platform '+id);
  return {id,groupId:item[0],platform:item[1],lat:item[2],lon:item[3],
   zone:item[4],mode:item[5],wheelchair:item[6],gtfsIds:item[7],alternateName:item[8]};
 }
 private async hash(value:string):Promise<Uint8Array>{
  if(!globalThis.crypto?.subtle)throw new PidStaticError('unsupported','SHA-256 requires Web Crypto');
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 }
 private async routeFilename(routeId:string):Promise<string>{
  const digest=await this.hash(routeId);
  return Array.from(digest.slice(0,8),x=>x.toString(16).padStart(2,'0')).join('')+'.json';
 }
 async getTrip(id:string,day:string,routeId?:string):Promise<PidTrip|null>{
  const manifest=await this.day(day);
  if(!id)throw new PidStaticError('invalid','Missing trip ID');
  let resolvedRoute=routeId??'';
  let filename:string;
  if(routeId){
   filename=await this.routeFilename(routeId);
  }else{
   const locator=await this.request<Record<string,[string,string]|string>>(
    'days/'+day+'/trips.json',manifest.generatedAt);
   const match=locator[id];
   if(!match)return null;
   if(Array.isArray(match)){resolvedRoute=match[0];filename=match[1];}
   else filename=match; // compatibility with the first phase-1A output
  }
  const items=await this.request<Record<string,PidTripRow>>(
   'days/'+day+'/routes/'+filename,manifest.generatedAt);
  const row=items[id];
  if(!row)return null;
  if(row.length!==7||!Array.isArray(row[6]))throw new PidStaticError('invalid','Corrupted PID trip row '+id);
  return {id,date:day,routeId:resolvedRoute,serviceId:row[0],headsign:row[1],directionId:row[2],
   blockId:row[3],shapeId:row[4],shortName:row[5],stopTimes:row[6]};
 }
 /** Explicitly verifies trip-to-route membership in the daily locator. */
 async getTripResolved(id:string,day:string,routeId?:string):Promise<PidTrip|null>{
  const manifest=await this.day(day);
  const locator=await this.request<Record<string,[string,string]|string>>(
   'days/'+day+'/trips.json',manifest.generatedAt);
  const match=locator[id];
  if(!match)return null;
  const actualRoute=Array.isArray(match)?match[0]:'';
  if(routeId&&actualRoute&&routeId!==actualRoute)return null;
  const trip=await this.getTrip(id,day,actualRoute||routeId);
  return trip;
 }
 async getTripStops(id:string,day:string,routeId?:string):Promise<PidTripStop[]|null>{
  const trip=await this.getTrip(id,day,routeId);
  if(!trip)return null;
  const [stops,mapping]=await Promise.all([this.getGtfsStops(),this.getStopMap()]);
  return pidTripStopRows(trip,stops,mapping);
 }
 async getDepartures(stopId:string,day:string):Promise<PidDeparture[]>{
  const manifest=await this.day(day);
  if(!stopId)throw new PidStaticError('invalid','Missing stop ID');
  const hash=await this.hash(stopId);
  const bucket=String(hash[0]%64).padStart(2,'0');
  const all=await this.request<Record<string,PidDepartureRow[]>>(
   'days/'+day+'/departures/'+bucket+'.json',manifest.generatedAt);
  return (all[stopId]??[]).map(([departureSeconds,tripId,routeId,stopSequence])=>
   ({stopId,date:day,departureSeconds,tripId,routeId,stopSequence}));
 }
 async getBlockTrips(blockId:string,day:string):Promise<PidBlockTrip[]>{
  const manifest=await this.day(day);
  if(!blockId)return [];
  const blocks=await this.request<Record<string,PidBlockRow[]>>(
   'days/'+day+'/blocks.json',manifest.generatedAt);
  return (blocks[blockId]??[]).map(([startSeconds,id,routeId])=>
   ({id,date:day,startSeconds,routeId}));
 }
 async getRouteShape(routeId:string,shapeId:string):Promise<PidShapePoint[]|null>{
  if(!routeId||!shapeId)return null;
  const filename=await this.routeFilename(routeId);
  const shapes=await this.shard<Record<string,PidShapePoint[]>>('shapes/'+filename);
  return shapes[shapeId]??null;
 }
 clearCache():void{
  this.cache.clear();this.pending.clear();this.manifestPromise=null;
  this.version='';this.lastManifest=null;this.manifestSource='none';
 }
 async clearPersistentCache():Promise<void>{
  this.clearCache();
  await this.persistent.clear().catch(()=>{});
 }
}
export const pidStatic=new PidStaticEngine();
