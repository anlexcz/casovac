import {useRef} from 'react';
import {useChainDiagnostics} from './chainDiagnostics';
import {findPlannedHandoff,verifyHandoffStops} from './chainHandoff';
import {useTripData} from './tripData';
import {path,vehicleId} from './featureUtils';
import type {Feature} from './featureUtils';
import type {LastSeen} from './lastSeen';
import type {useRecorder} from './recorder';

type Inputs={
 active:[string,string]|null;
 chosen:Feature|null;
 lastSeen:LastSeen|null;
 features:Feature[];
 token:string;
 tripId:string;
 trip:ReturnType<typeof useTripData>;
 now:number;
 selectedTrip:string;
 recordChain:ReturnType<typeof useRecorder>['chain'];
};
export function useChainTracking({active,chosen,lastSeen,features,token,tripId,trip,now,selectedTrip,recordChain}:Inputs){
 const chainRecordRef=useRef(recordChain);
 chainRecordRef.current=recordChain;
 const chainTargetRef=useRef<[string,string]|null>(active);
 chainTargetRef.current=active;
 const chainRecord=useRef((value:unknown)=>{
  const target=chainTargetRef.current;
  if(target)chainRecordRef.current(target[0],target[1],value);
 }).current;
 const chainDiagnostic=useChainDiagnostics({
  active,knownVehicle:chosen?vehicleId(chosen):lastSeen?.vehicle??'',
  token:token.trim(),
  enabled:!!active&&['5','6','9','10'].includes(active[0]),
  primaryFeatures:features,record:chainRecord
 });
 const plannedHandoff=active&&chosen&&selectedTrip===''?
  findPlannedHandoff(chainDiagnostic,{
   line:active[0],order:active[1],tripId,vehicle:vehicleId(chosen),
   start:path(chosen,'properties.trip.start_timestamp')
  },now):null;
 const nextTrip=useTripData(plannedHandoff?.next.tripId??'',token.trim());
 const continuity=plannedHandoff?verifyHandoffStops(trip.stops,nextTrip.stops):
  {ok:false,reason:'Navazující trip zatím nebyl nalezen.'};
 return {chainDiagnostic,plannedHandoff,nextTrip,continuity};
}
