import {useEffect,useState} from 'react';
import {findPlannedHeadways,EMPTY_PLANNED_HEADWAYS} from './plannedHeadways.ts';
import type {PlannedHeadways} from './plannedHeadways.ts';

/** The planned neighbours are chosen from the PID departure index, not from
 * vehiclepositions. Keep their identity independent of GPS and live delays.
 * The key includes the exact stop ID; stale requests cannot repaint a later
 * stop or another trip after an asynchronous download.
 */
export function usePlannedHeadways(args:{
 enabled:boolean;tripId:string;date:string;referenceStopId:string;
}):{data:PlannedHeadways;loading:boolean}{
 const {enabled,tripId,date,referenceStopId}=args;
 const key=enabled&&tripId&&date&&referenceStopId?
  [tripId,date,referenceStopId].join('|'):'';
 const [state,setState]=useState<{
  key:string;data:PlannedHeadways;loading:boolean
 }>({key:'',data:EMPTY_PLANNED_HEADWAYS,loading:false});
 useEffect(()=>{
  if(!key){setState({key:'',data:EMPTY_PLANNED_HEADWAYS,loading:false});return;}
  let alive=true;
  setState({key,data:EMPTY_PLANNED_HEADWAYS,loading:true});
  void findPlannedHeadways({tripId,date,referenceStopId})
   .then(data=>{if(alive)setState({key,data,loading:false});})
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
  {data:EMPTY_PLANNED_HEADWAYS,loading:!!key};
}
