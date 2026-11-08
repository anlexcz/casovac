import {useEffect,useRef,useState} from 'react';
import {findPlannedHeadways,EMPTY_PLANNED_HEADWAYS} from './plannedHeadways.ts';
import type {PlannedHeadways} from './plannedHeadways.ts';

/** The planned neighbours are chosen from the PID departure index, not from
 * vehiclepositions. Keep their identity independent of GPS and live delays.
 * The key includes the exact stop ID; stale requests cannot repaint a later
 * stop or another trip after an asynchronous download.
 */
export function usePlannedHeadways(args:{
 enabled:boolean;tripId:string;date:string;referenceStopId:string;nowMs:number;
}):{data:PlannedHeadways;loading:boolean}{
 const {enabled,tripId,date,referenceStopId,nowMs}=args;
 const key=enabled&&tripId&&date?
  [tripId,date,referenceStopId,referenceStopId?'':Math.floor(nowMs/60000)].join('|'):'';
 const lastConfirmed=useRef<{scope:string;data:PlannedHeadways}|null>(null);
 const scope=tripId+'|'+date;
 const [state,setState]=useState<{
  key:string;data:PlannedHeadways;loading:boolean
 }>({key:'',data:EMPTY_PLANNED_HEADWAYS,loading:false});
 useEffect(()=>{
  if(!key){setState({key:'',data:EMPTY_PLANNED_HEADWAYS,loading:false});return;}
  let alive=true;
  // Preserve the prior planned peer while the reference stop advances.
  // Never carry it across a different trip or service date.
  setState({key,data:lastConfirmed.current?.scope===scope?
   lastConfirmed.current.data:EMPTY_PLANNED_HEADWAYS,loading:true});
  void findPlannedHeadways({tripId,date,referenceStopId,nowMs})
   .then(data=>{if(alive){
    if(data.status==='ready')lastConfirmed.current={scope,data};
    setState({key,data,loading:false});
   }})
   .catch(e=>{
    if(alive)setState({key,data:{
     ...EMPTY_PLANNED_HEADWAYS,referenceStopId,
     reason:e instanceof Error?e.message:'PID GTFS je nedostupné.'
    },loading:false});
   });
  return()=>{alive=false;};
 },[key,tripId,date,referenceStopId]);
 return state.key===key?
  {data:state.data,loading:state.loading}:
  {data:lastConfirmed.current?.scope===scope?lastConfirmed.current.data:
   EMPTY_PLANNED_HEADWAYS,loading:!!key};
}
