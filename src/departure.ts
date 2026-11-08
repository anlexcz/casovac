import {useEffect,useMemo,useRef,useState} from 'react';
import type {GpsFix} from './position.ts';
import {distanceMeters} from './position.ts';
import type {Stop} from './tripData';

export type RoutePoint={lon:number;lat:number;metres:number};
export type DeparturePhase='waiting'|'at-stop'|'verifying'|'left';
export type DepartureTelemetry={
 phase:DeparturePhase;stopIndex:number|null;displayIndex:number|null;reason:string;
 samples:number;seconds:number;distance:number|null;along:number|null;
 increase:number|null;speed:number|null;accuracy:number|null;
 crossTrack:number|null;routeReady:boolean;lastSwitch:string|null;
};
type Evidence={time:number;distance:number;along:number;speed:number};
type State={phase:DeparturePhase;stopIndex:number|null;since:number;samples:Evidence[];
 lastTimestamp:number;displayIndex:number|null;lastSwitch:string|null;reason:string};
const INIT:State={phase:'waiting',stopIndex:null,since:0,samples:[],lastTimestamp:0,displayIndex:null,lastSwitch:null,reason:'Čekám na přiblížení k zastávce.'};
const LIMITS={minimumDepartureDistance:50,minimumSpeed:9,minimumIncrease:15,minimumDuration:4000,minimumSamples:3,approachRadius:35,maxAccuracy:35,maxGpsAge:15000,maxVehicleAge:45,maxVehicleDistance:250,maxCrossTrack:45};
function project(lon:number,lat:number,route:RoutePoint[],minMetres=-Infinity,maxMetres=Infinity){
 let best:{metres:number;crossTrack:number}|null=null;
 const cos=Math.cos(lat*Math.PI/180);
 for(let i=1;i<route.length;i++){
  const a=route[i-1],b=route[i];
  if(b.metres<minMetres||a.metres>maxMetres)continue;
  const x1=(a.lon-lon)*111320*cos,y1=(a.lat-lat)*111320;
  const dx=(b.lon-a.lon)*111320*cos,dy=(b.lat-a.lat)*111320;
  const t=Math.max(0,Math.min(1,-(x1*dx+y1*dy)/(dx*dx+dy*dy||1)));
  const crossTrack=Math.hypot(x1+t*dx,y1+t*dy);
  if(!best||crossTrack<best.crossTrack)best={metres:a.metres+t*(b.metres-a.metres),crossTrack};
 }
 return best;
}
export function buildStopProgress(stops:Stop[],route:RoutePoint[]):(number|null)[]{
 let previous=-Infinity;
 return stops.map(stop=>{
  if(stop.lat===null||stop.lon===null||route.length<2)return null;
  // Progress must be non-decreasing even if a line loops back near a previous platform.
  const p=project(stop.lon,stop.lat,route,previous-20);
  if(!p||p.crossTrack>90)return null;
  previous=Math.max(previous,p.metres);
  return p.metres;
 });
}
export function decodeRoute(raw:unknown):RoutePoint[]{
 const shapes=(raw as {shapes?:{features?:Array<{geometry?:{coordinates?:number[]};properties?:{shape_dist_traveled?:number}}>} }|null)?.shapes?.features;
 if(!Array.isArray(shapes))return [];
 let cumulative=0;let prev:[number,number]|null=null;
 const route:RoutePoint[]=[];
 for(const feature of shapes){
  const c=feature.geometry?.coordinates;
  if(!Array.isArray(c)||c.length<2||!Number.isFinite(c[0])||!Number.isFinite(c[1]))continue;
  if(prev)cumulative+=distanceMeters(prev[1],prev[0],c[1],c[0]);
  const travelled=feature.properties?.shape_dist_traveled;
  const metres=typeof travelled==='number'&&Number.isFinite(travelled)?travelled*1000:cumulative;
  if(route.length&&metres<=route[route.length-1].metres)continue;
  route.push({lon:c[0],lat:c[1],metres});prev=[c[0],c[1]];
 }
 return route;
}
function getNearestStop(gps:GpsFix,stops:Stop[],reference:number|null){
 const indexes=reference===null?stops.map((_,i)=>i):[reference-1,reference,reference+1].filter(i=>i>=0&&i<stops.length);
 const candidates=indexes.map(i=>{
  const stop=stops[i];
  return stop.lat===null||stop.lon===null?null:{index:i,distance:distanceMeters(gps.lat,gps.lon,stop.lat,stop.lon)};
 }).filter((v):v is {index:number;distance:number}=>v!==null).sort((a,b)=>a.distance-b.distance);
 return candidates[0]??null;
}
export function useDepartureDetection(args:{
 tripId:string;stops:Stop[];raw:unknown;gps:GpsFix|null;vehicle:[number,number]|null;
 vehicleAge:number|null;paired:boolean;now:number;baseIndex:number|null;manualIndex:number|null;
}):DepartureTelemetry{
 const {tripId,stops,raw,gps,vehicle,vehicleAge,paired,now,baseIndex,manualIndex}=args;
 const route=useMemo(()=>decodeRoute(raw),[raw]);
 const stopProgress=useMemo(()=>buildStopProgress(stops,route),[stops,route]);
 const [state,setState]=useState<State>(INIT);
 const stateRef=useRef<State>(INIT);
 const lastContext=useRef('');
 const context=tripId+'|'+stops.length+'|'+(manualIndex??'automatic')+'|'+(gps?'onboard':'remote');
 useEffect(()=>{
  lastContext.current=context;stateRef.current={...INIT,displayIndex:manualIndex??baseIndex};
  setState(stateRef.current);
 // A manual correction explicitly resets the state machine.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[context]);
 useEffect(()=>{
  if(!tripId||!stops.length||!gps)return;
  if(stateRef.current.lastTimestamp>=gps.timestamp)return;
  if(lastContext.current!==context)return;
  const previous=stateRef.current;
  const remember=(next:State)=>{stateRef.current=next;setState(next);};
  const age=now-gps.timestamp;
  if(age< -10000||age>LIMITS.maxGpsAge||gps.accuracy>LIMITS.maxAccuracy){
   remember({...previous,lastTimestamp:gps.timestamp,samples:[],phase:previous.phase==='left'?'left':'waiting',reason:'GPS je zastaralá nebo nepřesná.'});return;
  }
  if(!paired||!vehicle||vehicleAge===null||vehicleAge>LIMITS.maxVehicleAge){
   remember({...previous,lastTimestamp:gps.timestamp,samples:[],phase:previous.phase==='left'?'left':'waiting',reason:'Telefon není spárovaný s tramvají.'});return;
  }
  const nearest=getNearestStop(gps,stops,previous.displayIndex??baseIndex);
  const atStop=nearest&&nearest.distance<=LIMITS.approachRadius;
  if(previous.phase==='waiting'||previous.phase==='left'){
   if(atStop){
    remember({...previous,lastTimestamp:gps.timestamp,phase:'at-stop',stopIndex:nearest.index,displayIndex:nearest.index,since:gps.timestamp,samples:[],reason:'Tramvaj je v prostoru zastávky; sleduji její odjezd.'});
   }else{
    remember({...previous,lastTimestamp:gps.timestamp,
      displayIndex:previous.phase==='left'?previous.displayIndex:(baseIndex??previous.displayIndex),
      reason:'Opuštění nelze potvrdit bez předchozího zachycení zastávky.'});
   }
   return;
  }
  const stopIndex=previous.stopIndex;
  if(stopIndex===null||stopIndex>=stops.length-1){remember({...previous,lastTimestamp:gps.timestamp,reason:'Konec tripu nebo chybí předchozí zastávka.'});return;}
  const stop=stops[stopIndex];
  if(stop.lat===null||stop.lon===null){remember({...previous,lastTimestamp:gps.timestamp,reason:'Chybí souřadnice zastávky.'});return;}
  const direct=distanceMeters(gps.lat,gps.lon,stop.lat,stop.lon);
  const origin=stopProgress[stopIndex];
  const location=origin===null?null:project(gps.lon,gps.lat,route,origin-50,origin+900);
  const along=location&&origin!==null?location.metres-origin:null;
  if(along===null||location===null||location.crossTrack>LIMITS.maxCrossTrack){
   remember({...previous,lastTimestamp:gps.timestamp,samples:[],phase:'at-stop',reason:'Nelze ověřit postup po trase nebo je GPS mimo trasu.'});return;
  }
  if(direct<=LIMITS.approachRadius&&along<30){
   remember({...previous,lastTimestamp:gps.timestamp,phase:'at-stop',samples:[],reason:'Tramvaj je stále u zastávky.'});return;
  }
  const speed=gps.speed===null?null:gps.speed*3.6;
  if(speed===null||speed<LIMITS.minimumSpeed){
   remember({...previous,lastTimestamp:gps.timestamp,phase:'verifying',samples:[],reason:'Rychlost je pod 9 km/h nebo není dostupná.'});return;
  }
  const last=previous.samples[previous.samples.length-1];
  if(last&&(gps.timestamp-last.time>12000||direct<last.distance-5||along<last.along-5)){
   remember({...previous,lastTimestamp:gps.timestamp,phase:'verifying',samples:[{time:gps.timestamp,distance:direct,along,speed}],reason:'Vzdálenost není souvisle rostoucí; začínám nové ověření.'});return;
  }
  const sample={time:gps.timestamp,distance:direct,along,speed};
  const samples=[...previous.samples,sample].slice(-10);
  const first=samples[0];
  const duration=gps.timestamp-first.time;
  const increase=direct-first.distance;
  const alongIncrease=along-first.along;
  const ready=samples.length>=LIMITS.minimumSamples&&duration>=LIMITS.minimumDuration&&
   direct>=LIMITS.minimumDepartureDistance&&along>=LIMITS.minimumDepartureDistance&&
   increase>=LIMITS.minimumIncrease&&alongIncrease>=LIMITS.minimumIncrease;
  if(ready){
   const nextIndex=stopIndex+1;
   remember({...previous,lastTimestamp:gps.timestamp,phase:'left',stopIndex:null,displayIndex:nextIndex,samples:[],since:gps.timestamp,
    reason:'Opuštění potvrzeno: 50 m, 9 km/h, rostoucí vzdálenost a postup po trase.',
    lastSwitch:new Date(gps.timestamp).toLocaleTimeString('cs-CZ')+' · '+stop.name+' → '+stops[nextIndex].name});
  }else remember({...previous,lastTimestamp:gps.timestamp,phase:'verifying',samples,reason:
   'Ověřuji odjezd: '+samples.length+'/3 měření, '+(duration/1000).toFixed(1)+' s, růst '+increase+' m.'});
 // Only new GPS timestamps cause evaluation.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[gps?.timestamp,tripId,stops,vehicleAge,baseIndex,manualIndex]);
 const current=state.phase==='at-stop'||state.phase==='verifying'?state.stopIndex:state.displayIndex;
 const stop=current!==null?stops[current]:null;
 const distance=gps&&stop?.lat!==null&&stop?.lat!==undefined&&stop.lon!==null?distanceMeters(gps.lat,gps.lon,stop.lat,stop.lon):null;
 const progress=current!==null?stopProgress[current]:null;
 const p=gps&&progress!==null&&progress!==undefined?project(gps.lon,gps.lat,route,progress-50,progress+900):null;
 return {
  phase:state.phase,stopIndex:state.stopIndex,displayIndex:manualIndex??current??baseIndex,
  reason:state.reason,samples:state.samples.length,
  seconds:state.samples.length?(state.samples[state.samples.length-1].time-state.samples[0].time)/1000:0,
  distance,along:p&&progress!==null&&progress!==undefined?p.metres-progress:null,
  increase:state.samples.length>=2?state.samples[state.samples.length-1].distance-state.samples[0].distance:null,
  speed:gps?.speed===null||gps?.speed===undefined?null:gps.speed*3.6,
  accuracy:gps?.accuracy??null,crossTrack:p?.crossTrack??null,routeReady:route.length>=2&&stopProgress.some(n=>n!==null),
  lastSwitch:state.lastSwitch
 };
}
