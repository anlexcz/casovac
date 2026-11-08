import {path} from './featureUtils.ts';
import {decodeRoute,buildStopProgress} from './departure.ts';
import {normalizedStopId,distanceMeters} from './position.ts';
import type {Stop} from './tripData';

type Feature={properties?:Record<string,unknown>;geometry?:{coordinates?:unknown}};
const get=path;
const validNumber=(value:unknown):number|null=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
export function observationTimestamp(feature:Feature|null):number|null{
 const paths=['properties.last_position.origin_timestamp','properties.last_position.timestamp','properties.last_position.last_updated','properties.last_position.recorded_at','properties.last_position.updated_at','properties.origin_timestamp','properties.timestamp'];
 for(const path of paths){
  const raw=get(feature,path);
  if(raw===null||raw===undefined||raw==='')continue;
  const numeric=typeof raw==='number'?raw:typeof raw==='string'&&/^\d{10,13}$/.test(raw)?Number(raw):NaN;
  const ms=Number.isFinite(numeric)?numeric<1e11?numeric*1000:numeric:Date.parse(String(raw));
  if(Number.isFinite(ms)&&ms>Date.UTC(2020,0,1)&&ms<Date.now()+120000)return ms;
 }
 return null;
}
export type RemoteState={
 mode:'remote';status:'confirmed'|'estimated'|'stale'|'unknown'|'off-route';
 index:number|null;lastConfirmedIndex:number|null;sourceAge:number|null;apiAge:number|null;
 sourceTimestamp:number|null;reason:string;vehicleProgress:number|null;crossTrack:number|null;
 predictedProgress:number|null;estimatedSpeed:number|null;vehicleState:string;previousIndex:number|null;
 nextIndex:number|null;source:string;
};
type History={tripId:string;time:number;metres:number;lon:number;lat:number};
function project(lon:number,lat:number,route:ReturnType<typeof decodeRoute>){
 let closest:{metres:number;distance:number}|null=null;
 const c=Math.cos(lat*Math.PI/180);
 for(let i=1;i<route.length;i++){
  const a=route[i-1],b=route[i];
  const dx=(b.lon-a.lon)*111320*c,dy=(b.lat-a.lat)*111320;
  const ax=(a.lon-lon)*111320*c,ay=(a.lat-lat)*111320;
  const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
  const distance=Math.hypot(ax+t*dx,ay+t*dy);
  if(!closest||distance<closest.distance)closest={metres:a.metres+t*(b.metres-a.metres),distance};
 }
 return closest;
}
function sequenceIndex(stops:Stop[],raw:unknown){
 const sequence=validNumber(raw);
 if(sequence===null)return null;
 const idx=stops.findIndex(s=>s.sequence===sequence);
 return idx<0?null:idx;
}
export function remoteEstimate(args:{
 feature:Feature|null;stops:Stop[];raw:unknown;tripId:string;
 fetchedAt:number|null;now:number;history:History|null;
}):RemoteState{
 const {feature,stops,raw,tripId,fetchedAt,now,history}=args;
 const sourceTimestamp=observationTimestamp(feature);
 const sourceAge=sourceTimestamp===null?null:Math.max(0,Math.floor((now-sourceTimestamp)/1000));
 const apiAge=fetchedAt===null?null:Math.max(0,Math.floor((now-fetchedAt)/1000));
 const lp=get(feature,'properties.last_position');
 const stateRaw=get(lp,'state_position');
 const vehicleState=typeof stateRaw==='string'?stateRaw:'unknown';
 const previousIndex=sequenceIndex(stops,get(lp,'last_stop.sequence'));
 const nextIndex=sequenceIndex(stops,get(lp,'next_stop.sequence'));
 const base={mode:'remote' as const,sourceTimestamp,sourceAge,apiAge,estimatedSpeed:null as number|null,
  vehicleProgress:null as number|null,crossTrack:null as number|null,predictedProgress:null as number|null,
  lastConfirmedIndex:null as number|null,previousIndex,nextIndex,vehicleState,source:'none'};
 if(!feature||!stops.length)return {...base,index:null,status:'unknown',reason:'Čekám na identifikaci vozidla a jeho jízdní řád.'};
 const rawId=get(lp,'next_stop.id')??get(lp,'next_stop');
 const id=normalizedStopId(typeof rawId==='string'?rawId:'');
 const matches=id?stops.map((s,i)=>({s,i})).filter(x=>safelyNormalize(x.s.id)===id):[];
 const coords=feature.geometry?.coordinates;
 const lon=Array.isArray(coords)?Number(coords[0]):NaN,lat=Array.isArray(coords)?Number(coords[1]):NaN;
 const validCoords=Number.isFinite(lon)&&Number.isFinite(lat);
 const route=decodeRoute(raw);
 const stopProgress=buildStopProgress(stops,route);
 const projected=validCoords&&route.length>=2?project(lon,lat,route):null;
 const vehicleProgress=projected?.metres??null,crossTrack=projected?.distance??null;
 const baseResult={...base,vehicleProgress,crossTrack};
 // A valid sequence is an authoritative trip stop index even when stop_id is absent.
 const isAtStop=vehicleState==='at_stop';
 const isOnTrack=vehicleState==='on_track';
 const sequenceCandidate=isAtStop?(previousIndex??nextIndex):(nextIndex??previousIndex);
 const idCandidate=matches.length===1?matches[0].i:null;
 const reference=sequenceCandidate??idCandidate;
 const reliable=apiAge!==null&&apiAge<=50&&sourceAge!==null&&sourceAge<=90;
 if(projected&&crossTrack!==null&&crossTrack>150){
  return {...baseResult,index:reference,status:'off-route',source:reference===null?'none':'sequence',
   lastConfirmedIndex:reference,reason:'Vozidlo je mimo tvar plánované trasy. Zobrazuji pouze hlášenou zastávku.'};
 }
 if(apiAge===null||apiAge>90||sourceAge!==null&&sourceAge>120){
  return {...baseResult,index:reference,lastConfirmedIndex:reference,status:'stale',
   source:reference===null?'none':'sequence',reason:'Data vozidla jsou zastaralá; poslední hlášená zastávka zůstává bez predikce.'};
 }
 if(reference!==null){
  const descriptor=isAtStop?'Vozidlo hlásí pobyt v zastávce.':isOnTrack?'Vozidlo hlásí jízdu k následující zastávce.':'Zastávka podle hlášení vozidla.';
  return {...baseResult,index:reference,lastConfirmedIndex:reference,status:reliable?'confirmed':'estimated',
   source:sequenceCandidate!==null?'sequence':'stop_id',reason:descriptor+(sourceAge===null?' Čas vzniku polohy není dostupný.':sourceAge>90?' Údaj je starší než 90 s.':'')};
 }
 // Only when no reliable GTFS sequence is available, derive a bounded positional estimate.
 if(projected&&crossTrack!==null&&crossTrack<=100&&stopProgress.some(x=>x!==null)){
  const h=history&&history.tripId===tripId&&sourceTimestamp!==null&&sourceTimestamp>history.time
   &&sourceTimestamp-history.time<=90000&&projected.metres>=history.metres-25?history:null;
  const speed=h?Math.min(9.72,Math.max(0,(projected.metres-h.metres)/((sourceTimestamp!-h.time)/1000))):0;
  const extra=sourceAge!==null&&sourceAge<=30?Math.min(90,speed*Math.min(20,sourceAge)):0;
  const estimatedMetres=projected.metres+extra;
  const idx=stopProgress.findIndex(p=>p!==null&&p>=estimatedMetres-35);
  if(idx>=0)return {...baseResult,index:idx,estimatedSpeed:speed*3.6,predictedProgress:estimatedMetres,
   status:'estimated',source:'shape',reason:extra>0?'Krátká predikce z polohy na trase.':'Poloha na trase bez přesného pořadí zastávky.'};
 }
 if(validCoords){
  const near=stops.map((s,i)=>({i,metres:s.lat!==null&&s.lon!==null?distanceMeters(lat,lon,s.lat,s.lon):Infinity})).sort((a,b)=>a.metres-b.metres)[0];
  if(near&&near.metres<=150)return {...baseResult,index:near.i,status:'estimated',source:'nearest',
   reason:'Náhradní odhad z polohy vozidla bez spárovaného pořadí zastávky.'};
 }
 return {...baseResult,index:null,status:'unknown',reason:'Z dostupných dat nelze spolehlivě určit zastávku.'};
}
function safelyNormalize(id:string){return id?normalizedStopId(id):'';}
export type {History as RemoteHistory};
