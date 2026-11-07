import {useSyncExternalStore} from 'react';

/**
 * In-memory, token-free diagnostics for the stop-neighbour loader.
 * Never record request headers, API credentials, phone GPS or raw responses.
 * The user explicitly exports the sanitized log; nothing is uploaded.
 */
export type NeighbourDiagnosticEvent={
 at:number;
 kind:'request'|'response'|'error'|'discarded'|'filter'|'vehicle'|'warmup'|'blocked';
 stopId:string;
 stopName:string;
 tripId:string;
 endpoint:string;
 note?:string;
 elapsedMs?:number;
 httpStatus?:number|null;
 counts?:Record<string,number>;
 shape?:{
  topLevelKeys:string[];
  departuresType:string;
  samples:Array<Record<string,unknown>>;
 };
};
export type NeighbourDiagnosticSnapshot={
 events:NeighbourDiagnosticEvent[];
};
const MAX_EVENTS=80;
let snapshot:NeighbourDiagnosticSnapshot={events:[]};
const listeners=new Set<()=>void>();
export function recordNeighbourDiagnostic(event:NeighbourDiagnosticEvent):void{
 snapshot={events:[...snapshot.events,event].slice(-MAX_EVENTS)};
 for(const notify of listeners)notify();
}
function subscribe(listener:()=>void){
 listeners.add(listener);
 return ()=>{listeners.delete(listener);};
}
function getSnapshot(){return snapshot;}
export function useNeighbourDiagnostics():NeighbourDiagnosticSnapshot{
 return useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
}
const obj=(value:unknown):Record<string,unknown>=>
 value!==null&&typeof value==='object'&&!Array.isArray(value)?
 value as Record<string,unknown>:{};
const SENSITIVE_KEY=/(api.?key|token|auth|cookie|secret|private|password|gps|latitude|longitude|coordinates|location|vehicle|headers|email|phone|user.?id|ip.?address)/i;
const keys=(value:unknown):string[]=>Object.keys(obj(value)).filter(key=>!SENSITIVE_KEY.test(key)).slice(0,35);
const SAFE_FIELDS=new Set([
 'id','trip_id','short_name','route_short_name','type',
 'is_canceled','scheduled','predicted','is_available','seconds',
 'state','delay','stop_id','departure','arrival',
 'stop_sequence','platform_code'
]);
function sampleFields(input:unknown):Record<string,unknown>{
 const result:Record<string,unknown>={};
 for(const [key,value] of Object.entries(obj(input))){
  if(!SAFE_FIELDS.has(key))continue;
  if(value===null||typeof value==='number'||typeof value==='boolean')result[key]=value;
  else if(typeof value==='string')result[key]=value.slice(0,100);
  else if(Array.isArray(value))result[key]='array('+value.length+')';
  else if(typeof value==='object')result[key]={keys:keys(value)};
 }
 return result;
}
/** Describe the response schema without copying full vehicle or GPS payloads. */
export function summarizeNeighbourBoardResponse(raw:unknown):NonNullable<NeighbourDiagnosticEvent['shape']>{
 const root=obj(raw);
 const departures=root.departures;
 const list=Array.isArray(departures)?departures:[];
 return {
  topLevelKeys:keys(raw),
  departuresType:Array.isArray(departures)?'array('+departures.length+')':
   departures===undefined?'missing':typeof departures,
  samples:list.slice(0,3).map(item=>{
   const row=obj(item);
   const result:Record<string,unknown>={keys:keys(item)};
   for(const field of ['trip','route','stop','arrival_timestamp','departure_timestamp','delay']){
    const value=row[field];
    if(value!==undefined)result[field]={keys:keys(value),values:sampleFields(value)};
   }
   return result;
  })
 };
}
export function summarizeNeighbourBoardCounts(raw:unknown,selectedStopId:string){
 const rows=obj(raw).departures;
 const list=Array.isArray(rows)?rows:[];
 const get=(r:unknown,k:string)=>obj(obj(r)[k]);
 return {
  returned:list.length,
  matchingPlatform:list.filter(r=>get(r,'stop').id===selectedStopId).length,
  tramTypeZero:list.filter(r=>get(r,'route').type===0).length,
  matchingTram:list.filter(r=>get(r,'stop').id===selectedStopId&&get(r,'route').type===0).length,
  withTripId:list.filter(r=>typeof get(r,'trip').id==='string').length,
  withSchedule:list.filter(r=>get(r,'arrival_timestamp').scheduled||get(r,'departure_timestamp').scheduled).length,
  missingPlatform:list.filter(r=>!get(r,'stop').id).length
 };
}
/**
 * Inspect the exact timetable-record schema, not its private fields.
 * Useful when the public GTFS trip detail has names/times but no stop_id.
 */
export function summarizeTripStopSchema(raw:unknown):NonNullable<NeighbourDiagnosticEvent['shape']>{
 const root=obj(raw);
 const candidates:unknown[]=[root.stop_times,root.stopTimes,root.stoptimes,root.stops,
  obj(root.data).stop_times,obj(root.data).stops,obj(root.trip).stop_times];
 const list=candidates.find(Array.isArray);
 const rows=Array.isArray(list)?list:[];
 return {
  topLevelKeys:keys(raw),
  departuresType:'GTFS stop-times array ('+rows.length+')',
  samples:rows.slice(0,3).map(item=>{
   const rec=obj(item);
   const result:Record<string,unknown>={keys:keys(item)};
   for(const field of ['stop','properties','stop_info','stop_data']){
    if(rec[field]!==undefined)result[field]={keys:keys(rec[field]),
     propertiesKeys:keys(obj(rec[field]).properties)};
   }
   const idFields=['stop_id','stopId','id','stop_sequence','stop_name','arrival_time','departure_time'];
   result.fields=Object.fromEntries(idFields.filter(k=>rec[k]!==undefined)
    .map(k=>[k,typeof rec[k]==='string'||typeof rec[k]==='number'?rec[k]:typeof rec[k]]));
   return result;
  })
 };
}
export function downloadNeighbourDiagnostics():void{
 const payload={
  schema:'casovac-neighbours-diagnostics-v1',
  exportedAt:new Date().toISOString(),
  privacy:'No API token, request headers, raw position coordinates or phone GPS are captured.',
  events:snapshot.events
 };
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
 const a=document.createElement('a');
 a.href=url;
 a.download='casovac-okolni-spoje-diagnostika-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json';
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
