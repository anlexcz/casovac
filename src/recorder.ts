import {useCallback,useEffect,useRef,useState} from 'react';
import type {GpsFix} from './position';
import {distanceMeters} from './position';

export type RecordEvent={
 kind:'api'|'api_error'|'trip'|'gps'|'note'|'decision';
 receivedAt:string;receivedAtMs:number;
 data:unknown;
};
export type RecorderSession={
 schema:'casovac-diagnostics-v1';id:string;startedAt:string;endedAt:string|null;
 target:{line:string;order:string};
 options:{includePhoneCoordinates:boolean;pollMs:number;testScenario?:'gps-off'|'gps-remote'|'gps-onboard'};
 events:RecordEvent[];state:'recording'|'stopped';limits:{maxEvents:number};
};
const DATABASE='casovac-diagnostics-v1',STORE='recordings',KEY='current',MAX=2400;
function database():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(new Error('IndexedDB není dostupná.'));return;}
  const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error??new Error('Nepodařilo se otevřít úložiště.'));
 });
}
async function read():Promise<RecorderSession|null>{
 const db=await database();
 return new Promise((resolve,reject)=>{
  const t=db.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(KEY);
  r.onsuccess=()=>resolve((r.result as RecorderSession|undefined)??null);
  r.onerror=()=>reject(r.error??new Error('Čtení záznamu selhalo.'));
  t.oncomplete=()=>db.close();
  t.onerror=()=>{db.close();reject(t.error);};
 });
}
async function write(value:RecorderSession|null):Promise<void>{
 const db=await database();
 return new Promise((resolve,reject)=>{
  const t=db.transaction(STORE,'readwrite');
  if(value)t.objectStore(STORE).put(value,KEY);else t.objectStore(STORE).delete(KEY);
  t.oncomplete=()=>{db.close();resolve();};
  t.onerror=()=>{db.close();reject(t.error??new Error('Uložení záznamu selhalo.'));};
 });
}
function scrub(value:unknown):unknown{
 if(Array.isArray(value))return value.map(scrub);
 if(value&&typeof value==='object'){
  const clean:Record<string,unknown>={};
  for(const [key,item] of Object.entries(value)){
   if(/token|secret|authorization|api.?key/i.test(key))continue;
   clean[key]=scrub(item);
  }
  return clean;
 }
 return value;
}
function exportFile(session:RecorderSession){
 const exportCopy=structuredClone(session);
 // Raw Golemio snapshots are retained. Never export a private token.
 const safe=scrub(exportCopy);
 const blob=new Blob([JSON.stringify(safe,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;
 a.download='casovac-'+session.target.line+'-'+session.target.order+'-'+(session.options.testScenario??'test')+'-'+session.startedAt.replace(/[:.]/g,'-')+'.json';
 document.body.appendChild(a);a.click();a.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function useRecorder(){
 const [session,setSession]=useState<RecorderSession|null>(null);
 const ref=useRef<RecorderSession|null>(null);
 const queue=useRef<Promise<unknown>>(Promise.resolve());
 const lastGpsWrite=useRef(0);
 const [ready,setReady]=useState(false);
 const [error,setError]=useState('');
 const safeSave=useCallback((next:RecorderSession|null)=>{
  ref.current=next;setSession(next);
  queue.current=queue.current.then(()=>write(next)).catch(e=>setError('Záznam se nepodařilo uložit: '+String(e)));
 },[]);
 useEffect(()=>{
  let active=true;
  void read().then(value=>{
   if(!active)return;
   // An open session after refresh can be resumed when the tracked order is started again.
   ref.current=value;setSession(value);setReady(true);
  }).catch(e=>{if(active){setError('Lokální ukládání není dostupné: '+String(e));setReady(true);}});
  return()=>{active=false;};
 },[]);
 const start=useCallback((line:string,order:string,includePhoneCoordinates:boolean,testScenario:'gps-off'|'gps-remote'|'gps-onboard'='gps-off')=>{
  if(!ready||error)return;
  const time=new Date().toISOString();lastGpsWrite.current=0;
  safeSave({schema:'casovac-diagnostics-v1',id:time+'-'+line+'-'+order,startedAt:time,endedAt:null,
   target:{line,order},options:{includePhoneCoordinates,pollMs:20000,testScenario},events:[],state:'recording',limits:{maxEvents:MAX}});
 },[ready,error,safeSave]);
 const stop=useCallback(()=>{const old=ref.current;if(old?.state==='recording')safeSave({...old,state:'stopped',endedAt:new Date().toISOString()});},[safeSave]);
 const discard=useCallback(()=>safeSave(null),[safeSave]);
 const append=useCallback((kind:RecordEvent['kind'],data:unknown)=>{
  const old=ref.current;if(!old||old.state!=='recording')return;
  const current=Date.now(),events=[...old.events,{kind,receivedAt:new Date(current).toISOString(),receivedAtMs:current,data:scrub(data)}];
  if(events.length>=MAX){
   safeSave({...old,events,state:'stopped',endedAt:new Date(current).toISOString()});
   setError('Záznam dosáhl limitu '+MAX+' událostí. Exportuj JSON.');
  }else safeSave({...old,events});
 },[safeSave]);
 const api=useCallback((args:{line:string;order:string;responseStatus:number;requestStartedAt:number;responseAt:number;
  matchingCount:number;vehicle:unknown;gps:GpsFix|null;source:string;candidateVehicles?:unknown;queryMode?:string})=>{
  const old=ref.current;if(old?.state!=='recording'||old.target.line!==args.line||old.target.order!==args.order)return;
  const feature=args.vehicle as {geometry?:{coordinates?:unknown}}|null;
  const c=feature?.geometry?.coordinates;
  const metres=args.gps&&Array.isArray(c)&&c.length>=2?distanceMeters(args.gps.lat,args.gps.lon,Number(c[1]),Number(c[0])):null;
  const age=args.gps?args.responseAt-args.gps.timestamp:null;
  const gpsReliable=!!args.gps&&age!==null&&age>=-10000&&age<=15000&&args.gps.accuracy<=35;
  append('api',{requestStartedAt:new Date(args.requestStartedAt).toISOString(),responseAt:new Date(args.responseAt).toISOString(),
   durationMs:args.responseAt-args.requestStartedAt,status:args.responseStatus,matchingCount:args.matchingCount,
   gpsMode:!args.gps?'absent':!gpsReliable?'stale_or_inaccurate':metres!==null&&metres<=250?'near':'remote',
   phoneGpsAgeMs:age,phoneAccuracyM:args.gps?.accuracy??null,phoneVehicleDistanceM:metres,
   selectedVehicleSource:args.source,queryMode:args.queryMode??'default',
   candidateVehicles:args.candidateVehicles??null,vehicle:args.vehicle});
 },[append]);
 const apiError=useCallback((line:string,order:string,status:string,message:string)=>{
  if(ref.current?.target.line===line&&ref.current.target.order===order)append('api_error',{status,message});
 },[append]);
 const trip=useCallback((tripId:string,stops:unknown,raw:unknown)=>{
  const old=ref.current;if(old?.state!=='recording'||old.events.some(e=>e.kind==='trip'&&(e.data as {tripId?:string}).tripId===tripId))return;
  append('trip',{tripId,stops,raw});
 },[append]);
 const gps=useCallback((fix:GpsFix)=>{
  const old=ref.current;if(old?.state!=='recording'||!old.options.includePhoneCoordinates)return;
  // Keep high-enough resolution for a departing tram, but avoid thousands of
  // phone samples when the vehicle is elsewhere. Never infer onboard without
  // an independently known vehicle position.
  const recent=old.events.slice(-20).reverse().find(e=>e.kind==='api');
  const info=recent?.data as {phoneVehicleDistanceM?:number|null;gpsMode?:string}|undefined;
  const onboard=info?.gpsMode==='near'&&info.phoneVehicleDistanceM!==null&&
   info.phoneVehicleDistanceM!==undefined&&info.phoneVehicleDistanceM<=250;
  const minimumInterval=onboard?2000:30000;
  if(fix.timestamp-lastGpsWrite.current<minimumInterval)return;
  lastGpsWrite.current=fix.timestamp;
  append('gps',{...fix,recordingMode:onboard?'onboard':'remote'});
 },[append]);
 const decision=useCallback((data:unknown)=>append('decision',data),[append]);
 const note=useCallback((message:string)=>{if(message.trim())append('note',{message:message.trim()});},[append]);
 const download=useCallback(()=>{const value=ref.current;if(value)exportFile(value);},[]);
 return {session,ready,error,start,stop,discard,download,api,apiError,trip,gps,note,decision};
}
