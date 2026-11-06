import {useEffect} from 'react';
import type {Dispatch,MutableRefObject,SetStateAction} from 'react';
import {readLastSeen,saveLastSeen} from './lastSeen';
import type {LastSeen} from './lastSeen';
import {vehicleId} from './featureUtils';
import type {Feature,Obj} from './featureUtils';
import type {PlannedHandoff} from './chainHandoff';
import type {Stop} from './tripData';
import type {HandoffFallback} from './useVehicleTracking';
import type {useRecorder} from './recorder';
import {ACTIVE_KEY,ACTIVE_TTL,save} from './trackingStorage';

type Setter<T>=Dispatch<SetStateAction<T>>;
type HandoffRecord={from:string;to:string;vehicle:string;tripId:string;reason:string;time:number};
type Inputs={
 active:[string,string]|null;
 chosen:Feature|null;
 plannedHandoff:PlannedHandoff|null;
 continuity:{ok:boolean;reason:string};
 nextTrip:{tripId:string;loading:boolean};
 trip:{tripId:string;stops:Stop[]};
 tripId:string;
 manual:number|null;
 departureEvidence:{ok:boolean;reason:string};
 now:number;
 handoffFallbackRef:MutableRefObject<HandoffFallback|null>;
 recorder:ReturnType<typeof useRecorder>;
 setLastHandoff:Setter<HandoffRecord|null>;
 setSelectedTrip:Setter<string>;
 setManual:Setter<number|null>;
 setExpanded:Setter<boolean>;
 setFeatures:Setter<Feature[]>;
 setLastSeen:Setter<LastSeen|null>;
 setLastFetch:Setter<number|null>;
 setQuery:Setter<string>;
 setActive:Setter<[string,string]|null>;
};
export function useChainHandoff({
 active,chosen,plannedHandoff,continuity,nextTrip,trip,tripId,manual,departureEvidence,now,
 handoffFallbackRef,recorder,setLastHandoff,setSelectedTrip,setManual,setExpanded,
 setFeatures,setLastSeen,setLastFetch,setQuery,setActive
}:Inputs){
 const successorActive=plannedHandoff?.next.state==='at_stop'||plannedHandoff?.next.state==='on_track';
 const successorStart=plannedHandoff?Date.parse(String(plannedHandoff.next.start)):NaN;
 const alreadyMoved=successorActive&&Number.isFinite(successorStart)&&
  successorStart<=now+120000&&successorStart>=now-2*3600000;
 const handoffReady=!!active&&!!chosen&&!!plannedHandoff&&
  continuity.ok&&(departureEvidence.ok||alreadyMoved)&&
  nextTrip.tripId===plannedHandoff.next.tripId&&!nextTrip.loading&&
  trip.tripId===tripId&&trip.stops.length>1&&manual===null;
 useEffect(()=>{
  if(!handoffReady||!active||!chosen||!plannedHandoff)return;
  const next=plannedHandoff.next;
  const currentVehicle=vehicleId(chosen);
  if(!next.line||!next.order||!next.tripId)return;
  const target:[string,string]=[next.line,next.order];
  const from=active.join('/');
  const reason=(alreadyMoved&&!departureEvidence.ok?'Navazující trip je již aktivní.':departureEvidence.reason)+' '+continuity.reason;
  const synthetic:Feature={
   properties:{trip:next.rawTrip as Obj,
    last_position:{state_position:next.state,last_stop:next.lastStop,next_stop:next.nextStop}}
  };
  const previous=readLastSeen(active[0],active[1]);
  const remembered:LastSeen={
   line:next.line,order:next.order,vehicle:next.vehicle||currentVehicle,tripId:next.tripId,
   lastSeenAt:Date.now(),lastPositionAt:previous?.lastPositionAt??null,
   lon:previous?.lon??null,lat:previous?.lat??null,
   lastStop:'',nextStop:'',state:next.state,route:next.line
  };
  saveLastSeen(remembered);
  handoffFallbackRef.current={target:target.join('/'),vehicle:next.vehicle||currentVehicle,feature:synthetic,until:Date.now()+180000};
  setLastHandoff({from,to:target.join('/'),vehicle:next.vehicle||currentVehicle,tripId:next.tripId,reason,time:Date.now()});
  recorder.follow(next.line,next.order,next.tripId,reason);
  setSelectedTrip('');setManual(null);setExpanded(false);
  setFeatures([synthetic]);setLastSeen(remembered);setLastFetch(Date.now());
  setQuery(target.join('/'));
  save(ACTIVE_KEY,JSON.stringify({line:next.line,order:next.order,expires:Date.now()+ACTIVE_TTL,
   handoff:{from,to:target.join('/'),vehicle:next.vehicle||currentVehicle,tripId:next.tripId,reason,time:Date.now()}}));
  setActive(target);
 // A different active route context supersedes this effect.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[handoffReady,active?.[0],active?.[1],tripId,plannedHandoff?.next.tripId]);
}
