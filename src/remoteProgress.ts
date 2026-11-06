import {useRef} from 'react';
import type {RemoteState} from './remoteTracking';
import type {Stop} from './tripData';

export type RemoteProgress={
 index:number|null;predicted:boolean;reason:string;
 atStopAge:number|null;threshold:number|null;
};
type Memory={tripId:string;index:number|null;sourceTimestamp:number|null};
const parseClock=(value:string,reference:number):number|null=>{
 const m=/^(\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
 if(!m)return null;
 const date=new Date(reference);
 date.setHours(Number(m[1]),Number(m[2]),Number(m[3]),0);
 return date.getTime();
};
function delaySeconds(feature:unknown):number|null{
 const f=feature as {properties?:{last_position?:{delay?:{last_stop_arrival?:unknown;actual?:unknown}}}}|null;
 const d=f?.properties?.last_position?.delay;
 const raw=d?.last_stop_arrival??d?.actual;
 const n=Number(raw);
 return raw!==null&&raw!==undefined&&Number.isFinite(n)&&Math.abs(n)<=3600?n:null;
}
export type ProgressInput={
 tripId:string;stops:Stop[];remote:RemoteState;vehicle:unknown;
 now:number;terminalWaiting:boolean;
};
export function calculateRemoteProgress(input:ProgressInput,memory:Memory):RemoteProgress{
 const {tripId,stops,remote,vehicle,now,terminalWaiting}=input;
 if(memory.tripId!==tripId){memory.tripId=tripId;memory.index=null;memory.sourceTimestamp=null;}
 const base=remote.index;
 if(!tripId||!stops.length||base===null){
  return {index:base,predicted:false,reason:remote.reason,atStopAge:null,threshold:null};
 }
 const validData=remote.apiAge!==null&&remote.apiAge<=45&&
  remote.sourceAge!==null&&remote.sourceAge<=100&&
  remote.status!=='off-route'&&remote.status!=='stale';
 const held=remote.vehicleState==='at_stop'&&remote.previousIndex!==null;
 const stopIndex=held?remote.previousIndex!:base;
 const age=held&&remote.sourceTimestamp!==null?Math.max(0,(now-remote.sourceTimestamp)/1000):null;
 const after=stops[stopIndex+1];
 const current=stops[stopIndex];
 const clockReference=remote.sourceTimestamp??now;
 const plannedCurrent=current?parseClock(current.departure||current.arrival,clockReference):null;
 const plannedNext=after?parseClock(after.arrival||after.departure,clockReference):null;
 const interval=plannedCurrent!==null&&plannedNext!==null?
  Math.max(0,Math.round((plannedNext-plannedCurrent)/1000)):null;
 // Median observed interval from at_stop to the next on_track observation
 // is around a minute, but that includes Golemio's reporting latency.
 // Switch earlier, once the last stop observation has aged ~36–45 s,
 // not immediately when a planned timetable departure has elapsed.
 const threshold=interval!==null&&interval<=75?36:interval!==null&&interval<=135?40:45;
 const delay=delaySeconds(vehicle);
 const expected=plannedCurrent!==null&&delay!==null?plannedCurrent+delay*1000+10000:null;
 const likelyLeft=validData&&!terminalWaiting&&held&&after&&age!==null&&age>=threshold&&
  (expected===null||now>=expected)&&
  (plannedNext===null||plannedCurrent===null||plannedNext>plannedCurrent)&&
  remote.nextIndex===stopIndex+1;
 let proposal=base;
 let predicted=false;
 if(likelyLeft){proposal=stopIndex+1;predicted=true;}
 // Do not bounce back to the previous platform while Golemio repeats the
 // exact same at_stop record. Never leap over an unconfirmed stop.
 const previous=memory.index;
 if(previous!==null&&proposal!==null&&proposal<previous)proposal=previous;
 if(proposal!==null&&(previous===null||proposal>previous))memory.index=proposal;
 if(remote.sourceTimestamp!==null)memory.sourceTimestamp=remote.sourceTimestamp;
 if(terminalWaiting)return {index:0,predicted:false,reason:'Čekání na konečné.',atStopAge:age,threshold};
 return {index:proposal,predicted:predicted&&proposal===stopIndex+1,
  reason:predicted?'Předpokládaný odjezd: čas od posledního hlášení v zastávce, zpoždění a navazující pořadí.':
   remote.reason,atStopAge:age,threshold};
}

export function useRemoteProgress(input:ProgressInput):RemoteProgress{
 const memory=useRef<Memory>({tripId:'',index:null,sourceTimestamp:null});
 return calculateRemoteProgress(input,memory.current);
}
