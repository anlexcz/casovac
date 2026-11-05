import {useEffect,useRef,useState} from 'react';
import type {GpsFix} from './position';
import {distanceMeters} from './position';
import {decodeRoute} from './departure';

type Mode='remote'|'onboard';
export type OnboardDecision={mode:Mode;paired:boolean;gap:number|null;routeGap:number|null;
 reason:string;sourceAge:number|null;lastPairedAt:number|null};
type State={mode:Mode;lastNear:number|null;farCount:number;reason:string};
const initial:State={mode:'remote',lastNear:null,farCount:0,reason:'Telefon není ověřen ve vozidle.'};
function distanceToRoute(lat:number,lon:number,raw:unknown):number|null{
 const points=decodeRoute(raw);
 if(points.length<2)return null;
 const cos=Math.cos(lat*Math.PI/180);
 let best=Infinity;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];
  const x=(a.lon-lon)*111320*cos,y=(a.lat-lat)*111320;
  const dx=(b.lon-a.lon)*111320*cos,dy=(b.lat-a.lat)*111320;
  const f=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy||1)));
  best=Math.min(best,Math.hypot(x+f*dx,y+f*dy));
 }
 return Math.round(best);
}
export function useOnboardMode(input:{
 tripId:string;wanted:boolean;gps:GpsFix|null;vehicle:[number,number]|null;
 raw:unknown;now:number;sourceAge:number|null;apiAge:number|null;
}):OnboardDecision{
 const {tripId,wanted,gps,vehicle,raw,now,sourceAge,apiAge}=input;
 const state=useRef<State>(initial);
 const [decision,setDecision]=useState<State>(initial);
 const context=useRef('');
 const gap=gps&&vehicle?distanceMeters(gps.lat,gps.lon,vehicle[1],vehicle[0]):null;
 const routeGap=gps?distanceToRoute(gps.lat,gps.lon,raw):null;
 const valid=!!wanted&&!!gps&&now-gps.timestamp<=15000&&now-gps.timestamp>=-10000&&gps.accuracy<=35;
 const freshVehicle=sourceAge!==null&&sourceAge<=35&&apiAge!==null&&apiAge<=45;
 useEffect(()=>{
  const ctx=tripId+'|'+wanted;
  if(context.current!==ctx){context.current=ctx;state.current={...initial};setDecision({...initial});}
 },[tripId,wanted]);
 useEffect(()=>{
  if(!valid||gap===null){
   const result={...initial,reason:!wanted?'GPS telefonu vypnutá.':'Chybí aktuální či přesná GPS nebo poloha vozidla.'};
   state.current=result;setDecision(result);return;
  }
  const old=state.current;
  // Initial pairing must be near the independently reported vehicle. Route
  // proximity alone must never claim the user is on board.
  if(old.mode==='remote'){
   if(gap<=250&&(!freshVehicle?gap<=100:true)){
    const next:State={mode:'onboard',lastNear:now,farCount:0,reason:'Telefon ověřen poblíž vozidla.'};
    state.current=next;setDecision(next);
   }else{
    const reason=gap>=1000?'Telefon je nejméně kilometr od tramvaje.':
     'Čekám na přiblížení telefonu k tramvaji.';
    if(old.reason!==reason){const next={...old,reason};state.current=next;setDecision(next);}
   }
   return;
  }
  // A stale vehicle coordinate can lag a real tram several hundred metres.
  // Only preserve an already established pairing, and only when the phone
  // remains close to the trip's track with recent GPS.
  const corridor=routeGap!==null&&routeGap<=65;
  const lagAllowed=sourceAge!==null&&sourceAge>=25&&sourceAge<=125&&gap<=750&&corridor;
  if(gap<=250){
   const next:State={mode:'onboard',lastNear:now,farCount:0,reason:'Telefon a vůz jsou poblíž.'};
   state.current=next;setDecision(next);return;
  }
  if(lagAllowed&&old.lastNear!==null&&now-old.lastNear<=150000){
   const next:State={...old,farCount:0,reason:'GPS vozu je opožděná; telefon pokračuje po trase.'};
   state.current=next;setDecision(next);return;
  }
  const farCount=old.farCount+1;
  if(gap>=1000||farCount>=3||old.lastNear===null||now-old.lastNear>150000){
   const next:State={...initial,reason:gap>=1000?'Telefon je více než kilometr od tramvaje.':'Párování s vozidlem zaniklo.'};
   state.current=next;setDecision(next);
  }else{
   const next={...old,farCount,reason:'Ověřuji nesoulad GPS telefonu a polohy vozidla.'};
   state.current=next;setDecision(next);
  }
 // Evaluate only on new GPS samples or new vehicle fixes, not each clock tick.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tripId,wanted,gps?.timestamp,vehicle?.[0],vehicle?.[1]]);
 return {mode:decision.mode,paired:decision.mode==='onboard'&&valid,gap,routeGap,
  sourceAge,lastPairedAt:decision.lastNear,reason:decision.reason};
}
