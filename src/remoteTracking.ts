import {decodeRoute,buildStopProgress} from './departure';
import {normalizedStopId,distanceMeters} from './position';
import type {Stop} from './tripData';

type Feature={properties?:Record<string,unknown>;geometry?:{coordinates?:unknown}};
const get=(o:unknown,p:string):unknown=>p.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Record<string,unknown>)[k]:undefined,o);
export function observationTimestamp(feature:Feature|null):number|null{
 const paths=['properties.last_position.origin_timestamp','properties.last_position.timestamp','properties.last_position.last_updated','properties.last_position.recorded_at','properties.last_position.updated_at','properties.origin_timestamp','properties.timestamp'];
 for(const path of paths){
  const raw=get(feature,path);
  if(raw===null||raw===undefined||raw==='')continue;
  const n=typeof raw==='number'?raw:typeof raw==='string'&&/^\d{10,13}$/.test(raw)?Number(raw):NaN;
  const ms=Number.isFinite(n)?n<1e11?n*1000:n:Date.parse(String(raw));
  if(Number.isFinite(ms)&&ms>Date.UTC(2020,0,1)&&ms<Date.now()+120000)return ms;
 }
 return null;
}
export type RemoteState={
 mode:'remote';status:'confirmed'|'estimated'|'stale'|'unknown'|'off-route';
 index:number|null;lastConfirmedIndex:number|null;sourceAge:number|null;apiAge:number|null;
 sourceTimestamp:number|null;reason:string;vehicleProgress:number|null;crossTrack:number|null;
 predictedProgress:number|null;estimatedSpeed:number|null;
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
export function remoteEstimate(args:{
 feature:Feature|null;stops:Stop[];raw:unknown;tripId:string;
 fetchedAt:number|null;now:number;history:History|null;
}):RemoteState{
 const {feature,stops,raw,tripId,fetchedAt,now,history}=args;
 const sourceTimestamp=observationTimestamp(feature);
 const sourceAge=sourceTimestamp===null?null:Math.max(0,Math.floor((now-sourceTimestamp)/1000));
 const apiAge=fetchedAt===null?null:Math.max(0,Math.floor((now-fetchedAt)/1000));
 const base={mode:'remote' as const,sourceTimestamp,sourceAge,apiAge,estimatedSpeed:null as number|null,
  vehicleProgress:null as number|null,crossTrack:null as number|null,predictedProgress:null as number|null,
  lastConfirmedIndex:null as number|null};
 if(!feature||!stops.length)return {...base,index:null,status:'unknown',reason:'Čekám na identifikaci vozidla a jeho jízdní řád.'};
 if(apiAge===null||apiAge>90||sourceAge!==null&&sourceAge>90)return {...base,index:null,status:'stale',reason:'Hlášení vozidla je zastaralé; predikce je pozastavená.'};
 const rawId=get(feature,'properties.last_position.next_stop.id')??get(feature,'properties.last_position.next_stop');
 const nextId=normalizedStopId(typeof rawId==='string'?rawId:'');
 const matches=nextId?stops.map((s,i)=>({s,i})).filter(x=>normalizedStopId(x.s.id)===nextId):[];
 const coords=feature.geometry?.coordinates;
 const lon=Array.isArray(coords)?Number(coords[0]):NaN,lat=Array.isArray(coords)?Number(coords[1]):NaN;
 const validCoords=Number.isFinite(lon)&&Number.isFinite(lat);
 const route=decodeRoute(raw);
 const stopProgress=buildStopProgress(stops,route);
 const projected=validCoords&&route.length>=2?project(lon,lat,route):null;
 const vehicleProgress=projected?.metres??null;
 const crossTrack=projected?.distance??null;
 const offRoute=projected!==null&&crossTrack!==null&&crossTrack>150;
 const baseResult={...base,vehicleProgress,crossTrack};
 if(offRoute)return {...baseResult,index:null,status:'off-route',reason:'Poloha vozidla je mimo plánovanou trasu. Predikce pozastavena.'};
 // A prior unique ID is only trusted when the reported observation is recent.
 if(matches.length===1&&sourceAge!==null&&sourceAge<=45)return {...baseResult,index:matches[0].i,lastConfirmedIndex:matches[0].i,
  status:'confirmed',reason:'Následující zastávka přímo z aktuálního hlášení Golemia.'};
 if(projected&&crossTrack!==null&&crossTrack<=100&&stopProgress.some(x=>x!==null)){
  const h=history&&history.tripId===tripId&&sourceTimestamp!==null&&sourceTimestamp>history.time
   &&sourceTimestamp-history.time<=90000&&projected.metres>=history.metres-25
   ?history:null;
  const speed=h?Math.min(35/3.6,Math.max(0,(projected.metres-h.metres)/((sourceTimestamp!-h.time)/1000))):0;
  // Short extrapolation only from distinct, chronologically ordered vehicle observations.
  const extrapolated=sourceAge!==null&&sourceAge<=30?Math.min(90,speed*Math.min(20,sourceAge)):0;
  const estimatedMetres=projected.metres+extrapolated;
  const nextIndex=stopProgress.findIndex((p,i)=>p!==null&&p>=estimatedMetres-35&&i<stops.length);
  if(nextIndex>=0)return {...baseResult,index:nextIndex,estimatedSpeed:speed*3.6,predictedProgress:estimatedMetres,
   status:'estimated',reason:extrapolated>0?'Odhad pohybu po trase z posledních dvou hlášení.':'Odhad zastávky podle skutečné polohy vozidla na trase.'};
 }
 if(matches.length===1)return {...baseResult,index:matches[0].i,lastConfirmedIndex:matches[0].i,
  status:'estimated',reason:sourceAge===null?'ID zastávky z Golemia, čas vzniku hlášení není dostupný.':'ID zastávky z Golemia; ověřuji stáří a polohu.'};
 if(validCoords){
  const near=stops.map((s,i)=>({i,metres:s.lat!==null&&s.lon!==null?distanceMeters(lat,lon,s.lat,s.lon):Infinity})).sort((a,b)=>a.metres-b.metres)[0];
  if(near&&near.metres<=200)return {...baseResult,index:near.i,status:'estimated',reason:'Odhad podle vzdálenosti od polohy vozidla, bez GPS telefonu.'};
 }
 return {...baseResult,index:null,status:'unknown',reason:'Z dostupných hlášení nelze bezpečně určit následující zastávku.'};
}
export type {History as RemoteHistory};
