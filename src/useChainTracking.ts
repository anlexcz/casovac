import {useRef} from 'react';
import {useChainDiagnostics} from './chainDiagnostics';
import {validBlockBoundary} from './blockPair';
import {useOnlineBlockPair} from './useOnlineBlockPair';
import type {PlannedHandoff} from './chainHandoff';
import {useTripData} from './tripData';
import {vehicleId} from './featureUtils';
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
 selectedTrip:string;
 recordChain:ReturnType<typeof useRecorder>['chain'];
};
export function useChainTracking({active,chosen,lastSeen,features,token,tripId,trip,selectedTrip,recordChain}:Inputs){
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
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const block=useOnlineBlockPair({tripId,line:active?.[0]??'',token:token.trim(),date,
  snapshot:chainDiagnostic,enabled:!!active&&!!chosen&&selectedTrip===''&&['5','6','9','10'].includes(active[0])});
 const resolvedPair=block.pair;
 const freshPartner=chainDiagnostic?.related.find(candidate=>candidate.tripId===resolvedPair?.partner.tripId);
 // Block identity is cached, but live state/order must always come from fresh telemetry.
 const pair=resolvedPair&&freshPartner?{...resolvedPair,partner:freshPartner}:resolvedPair;
 const plannedHandoff:PlannedHandoff|null=pair?.role==='first'?
  {next:pair.partner,reason:pair.reason}:null;
 const nextTrip=useTripData(plannedHandoff?.next.tripId??'',token.trim());
 const previousPartner=pair?.role==='second'?pair.partner:null;
 const previousTrip=useTripData(previousPartner?.tripId??'',token.trim());
 const continuity=pair?.role==='first'&&nextTrip.stops.length?
  {ok:validBlockBoundary(trip.stops,nextTrip.stops),reason:pair.reason}:
  pair?.role==='second'&&previousTrip.stops.length?
   {ok:validBlockBoundary(previousTrip.stops,trip.stops),reason:pair.reason}:
   {ok:false,reason:block.reason||'Navazující trip zatím nebyl nalezen.'};
 return {chainDiagnostic,plannedHandoff,nextTrip,previousTrip,previousPartner,continuity,block};
}
