import {useEffect,useMemo,useRef,useState} from 'react';
import {selectTrip,isBeforeTrip,stateOf,terminalTrip} from './tripSelection';
import {useTripData,countdownSeconds} from './tripData';
import {safeStaticServiceDate} from './staticTripAdapter.ts';
import {useChainTracking} from './useChainTracking';
import {useOrderLookup} from './useOrderLookup';
import {departureForHandoff} from './chainHandoff';
import {usePosition} from './position';
import {useDepartureDetection} from './departure';
import {useRecorder} from './recorder';
import {remoteEstimate} from './remoteTracking';
import {useRemoteProgress} from './remoteProgress';
import type {RemoteHistory} from './remoteTracking';
import {distanceMeters} from './position';
import {useOnboardMode} from './onboard';
import {readLastSeen,saveLastSeen,extractRecordedVehicle,saveLastSeenForService} from './lastSeen';
import type {LastSeen} from './lastSeen';
import {path,text,selectedTripId,vehicleId,routeOf} from './featureUtils';
import {serviceFromFeature,unverifiedService,observeService,operatingDate,matchesCurrent} from './trackedService';
import type {TrackedService} from './trackedService';
import {useChainHandoff} from './useChainHandoff';
import type {Feature} from './featureUtils';
import {useVehicleTracking} from './useVehicleTracking';
import {useCoreDutyTracking} from './useCoreDutyTracking';
import {serviceKey} from './trackedService';
import {useGpsTracking} from './useGpsTracking';
import {usePlannedHeadways} from './usePlannedHeadways.ts';
import {usePlannedPeerPositions} from './usePlannedPeerPositions.ts';
import {resolvePlannedLiveHeadways} from './plannedLiveHeadways.ts';
import {useStopNeighbours} from './useStopNeighbours';
import {useAutoPlatformPlan} from './useAutoPlatformPlan.ts';
import {pickAutoPlatform,confirmedAtStop,confirmedBeyondStop,platformMarkers} from './autoPlatformLifecycle.ts';
import {DEFAULT_NEIGHBOUR_SETTINGS} from './stopNeighbours';
import type {NeighbourSettings} from './stopNeighbours';
export {vehicleId} from './featureUtils';


import {TOKEN_KEY,ROUTE_KEY,ACTIVE_KEY,ACTIVE_TTL,recentTracking,stored,save,restoreTrackedService,storeTrackedService} from './trackingStorage';
export const parseOrder=(q:string):[string,string]|null=>{
 const match=/^(\d{1,3})\s*\/\s*(\d{1,4})$/.exec(q.trim());
 return match?[match[1],match[2]]:null;
};
export function useAppController(){
 const [token,setToken]=useState(()=>stored(TOKEN_KEY));
 const [rememberToken,setRememberToken]=useState(()=>!!stored(TOKEN_KEY));
 const [tokenVisible,setTokenVisible]=useState(false);
 const [settings,setSettings]=useState(false);
 const [query,setQuery]=useState(()=>stored(ROUTE_KEY));
 const [active,setActive]=useState<[string,string]|null>(()=>stored(TOKEN_KEY)?recentTracking():null);
 const [trackedService,setTrackedService]=useState<TrackedService|null>(()=>stored(TOKEN_KEY)?restoreTrackedService():null);
 const [diagnostics,setDiagnostics]=useState(false);
 const [showHeadways,setShowHeadways]=useState(()=>stored('casovac:show-headways:v1')!=='false');
 const [neighbourSettings,setNeighbourSettings]=useState<NeighbourSettings>(()=>{
  try{
   const json=JSON.parse(stored('casovac:neighbour-settings:v1')) as Partial<NeighbourSettings>;
   return {...DEFAULT_NEIGHBOUR_SETTINGS,...json};
  }catch{return DEFAULT_NEIGHBOUR_SETTINGS;}
 });
 const [neighbourIndex,setNeighbourIndex]=useState<number|null>(null);
 const [pinnedAutoNeighbour,setPinnedAutoNeighbour]=useState<{tripId:string;index:number}|null>(null);
 useEffect(()=>{save('casovac:neighbour-settings:v1',JSON.stringify(neighbourSettings));},[neighbourSettings]);
 const updateNeighbourSettings=(patch:Partial<NeighbourSettings>)=>
  setNeighbourSettings(old=>({...old,...patch}));

 useEffect(()=>{save('casovac:show-headways:v1',showHeadways?'true':'false');},[showHeadways]);
 const [selectedTrip,setSelectedTrip]=useState('');
 const [manual,setManual]=useState<number|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [editing,setEditing]=useState(false);
 const [submittedLookup,setSubmittedLookup]=useState('');
 const [lookupNonce,setLookupNonce]=useState(0);
 const submitLookup=()=>{
  setSubmittedLookup(query.trim());
  setLookupNonce(value=>value+1);
 };
 const resetLookup=()=>setSubmittedLookup('');
 const [lastSeen,setLastSeen]=useState<LastSeen|null>(null);
 const [lastHandoff,setLastHandoff]=useState<{from:string;to:string;vehicle:string;tripId:string;reason:string;time:number}|null>(()=>{
  try{
   const saved=JSON.parse(stored(ACTIVE_KEY)) as {line?:string;order?:string;expires?:number;handoff?:{from:string;to:string;vehicle:string;tripId:string;reason:string;time:number}};
   const handoff=saved.handoff;
   return saved.expires&&saved.expires>Date.now()&&handoff&&handoff.to===saved.line+'/'+saved.order?handoff:null;
  }catch{return null;}
 });
 const [error,setError]=useState('');
 const [now,setNow]=useState(Date.now());
 const handoffFallbackRef=useRef<{target:string;vehicle:string;feature:Feature;until:number}|null>(null);
 const recorder=useRecorder();
 const {gpsWanted,setGpsWanted,gps,gpsError,toggleGPS}=useGpsTracking(recorder.gps);
 const recordDecisionRef=useRef(recorder.decision);recordDecisionRef.current=recorder.decision;
 const lastDecisionRef=useRef('');
 const historyRef=useRef<{previous:RemoteHistory|null;current:RemoteHistory|null}>({previous:null,current:null});

 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{save(ROUTE_KEY,query.trim());},[query]);
 const lookupConfirmed=!!submittedLookup&&submittedLookup===query.trim();
 const {lookup,lookupLine,lookupOrder,queryKind,queryVehicle,results,lookupReady,searchingAcrossRoutes,stopNames}=useOrderLookup(
  lookupConfirmed?submittedLookup:'',editing&&lookupConfirmed,token,now,lookupNonce);
 useEffect(()=>{if(active&&token.trim()){
  // Refresh only when a route is actively selected; do not keep extending on refresh.
  const raw=stored(ACTIVE_KEY);let storedRoute:null|{line:string;order:string;expires:number}=null;
  try{storedRoute=raw?JSON.parse(raw):null;}catch{/* expired or corrupt */}
  if(!storedRoute||storedRoute.line!==active[0]||storedRoute.order!==active[1]||storedRoute.expires<Date.now()){
   save(ACTIVE_KEY,JSON.stringify({line:active[0],order:active[1],expires:Date.now()+ACTIVE_TTL}));
  }
 }},[active,token]);
 useEffect(()=>{
  if(!active)return;
  const storedValue=readLastSeen(active[0],active[1]);
  const recorded=extractRecordedVehicle(recorder.session,active[0],active[1]);
  setLastSeen(storedValue&&recorded?storedValue.lastSeenAt>=recorded.lastSeenAt?storedValue:recorded:storedValue??recorded);
 },[active?.[0],active?.[1],recorder.session?.id]);
 useEffect(()=>{if(rememberToken)save(TOKEN_KEY,token.trim());else save(TOKEN_KEY,'');},[rememberToken,token]);


 const {features,setFeatures,lastFetch,setLastFetch,queryMode,relatedVehicle,terminalCandidates,loading}=useVehicleTracking({active,trackedService,token,recorder,gps,setLastSeen,setError,handoffFallbackRef});


 const resolved=active?selectTrip(features,active[0],active[1],now,lastSeen?.vehicle):null;
 const matches=resolved?.matches??[];
 const candidateFeature=selectedTrip?features.find(f=>selectedTripId(f)===selectedTrip)??null:resolved?.feature??null;
 const chosen=candidateFeature;
 const tripId=chosen?selectedTripId(chosen):'';
 // Step C: keep the stable duty next to (not instead of) the legacy live
 // line/order tracker. Never overwrite a verified origin with a different one.
 useEffect(()=>{
  if(!active||!chosen||selectedTrip)return;
  setTrackedService(previous=>{
   const sameCurrent=!!previous&&matchesCurrent(previous,active[0],active[1]);
   const confirmedHandoff=lastHandoff?.to===active.join('/')&&
    previous?.sequenceId===active[1];
   if(previous&&!sameCurrent&&!confirmedHandoff)return previous;
   const updated=observeService(previous,chosen,previous?.serviceDate??operatingDate(Date.now()),
    active[0],active[1]);
   return updated&&JSON.stringify(updated)!==JSON.stringify(previous)?updated:previous;
  });
 },[active?.[0],active?.[1],tripId,chosen,lastHandoff?.to,selectedTrip]);
 useEffect(()=>{
  if(!active||!trackedService||!matchesCurrent(trackedService,active[0],active[1]))return;
  // Do not extend the expiration on each API poll.
  const raw=stored(ACTIVE_KEY);
  let expires=Date.now()+ACTIVE_TTL;
  try{const v=JSON.parse(raw) as {expires?:number};if(v.expires&&v.expires>Date.now())expires=v.expires;}catch{/* fine */}
  storeTrackedService(trackedService,expires);
 },[trackedService,active?.[0],active?.[1]]);
 useEffect(()=>{
  if(!chosen||!trackedService?.verified||!active||
   !matchesCurrent(trackedService,active[0],active[1]))return;
  const last=readLastSeen(active[0],active[1]);
  if(last)saveLastSeenForService(trackedService,last);
 },[tripId,trackedService?.originRoute,trackedService?.sequenceId,active?.[0],active?.[1],lastSeen?.vehicle]);

 // A verified tracked duty still needs an exact trip match before we trust its
 // service date. No guessed date from trip_id suffix or calendar midnight.
 const staticDate=trackedService?.verified&&trackedService.currentTripId===tripId&&
  active&&matchesCurrent(trackedService,active[0],active[1])
  ?safeStaticServiceDate(trackedService.serviceDate,true,new Date(now)):'';
 const trip=useTripData(tripId,token.trim(),staticDate,
  staticDate&&chosen?routeOf(chosen):'');
 const {chainDiagnostic,plannedHandoff,nextTrip,previousTrip,previousPartner,continuity}=useChainTracking({
  active,chosen,lastSeen,features,token,tripId,trip,selectedTrip,recordChain:recorder.chain
 });
 // Planned peer selection is independent of live vehiclepositions/delays.
 // A verified current GTFS stop_id is needed to avoid comparing the wrong
 // platform or the wrong direction on a repeating loop.
 const planTripId=tripId||(trackedService?.verified&&active&&
  matchesCurrent(trackedService,active[0],active[1])?
  trackedService.currentTripId??'':'');
 const planDate=trackedService?.verified&&planTripId&&
  trackedService.currentTripId===planTripId&&active&&
  matchesCurrent(trackedService,active[0],active[1])?
  safeStaticServiceDate(trackedService.serviceDate,true,new Date(now)):'';
 const plannedReferenceStopId=String(path(chosen,'properties.last_position.next_stop.id')??'');
 const plannedHeadways=usePlannedHeadways({enabled:showHeadways&&!!active,
  tripId:planTripId,date:planDate,referenceStopId:plannedReferenceStopId,nowMs:now});
 const peerPositions=usePlannedPeerPositions({
  enabled:showHeadways&&!!active,planned:plannedHeadways.data,
  features,token:token.trim(),now,date:planDate
 });
 const plannedLiveHeadways=resolvePlannedLiveHeadways({
  planned:plannedHeadways.data,selected:chosen,features:peerPositions.features,now,
  tripIds:peerPositions.tripIds
 });
 const age=lastFetch===null?null:Math.max(0,Math.floor((now-lastFetch)/1000));
 const gpsAge=gps?Math.max(0,Math.floor((now-gps.timestamp)/1000)):null;
 const coords=chosen?.geometry?.coordinates;
 const vehicleCoords:[number,number]|null=Array.isArray(coords)&&coords.length>=2&&Number.isFinite(Number(coords[0]))&&Number.isFinite(Number(coords[1]))?[Number(coords[0]),Number(coords[1])]:null;
 const nextStopId=text(path(chosen,'properties.last_position.next_stop.id')??path(chosen,'properties.last_position.next_stop'));
 const pos=usePosition(trip.stops,tripId,nextStopId,gps,vehicleCoords,age,now);
 const remote=remoteEstimate({feature:chosen??null,stops:trip.stops,raw:trip.raw,tripId,fetchedAt:lastFetch,now,history:historyRef.current.previous});
 const sourceAge=remote.sourceAge;
 const onboard=useOnboardMode({vehicleId:chosen?vehicleId(chosen):'',wanted:gpsWanted,gps,vehicle:vehicleCoords,raw:trip.raw,
  now,sourceAge,apiAge:age});
 const compatible=onboard.paired;
 useEffect(()=>{
  const timestamp=remote.sourceTimestamp,metres=remote.vehicleProgress;
  if(!tripId||timestamp===null||metres===null||!vehicleCoords)return;
  const current=historyRef.current.current;
  if(current&&current.tripId===tripId&&current.time===timestamp)return;
  historyRef.current={
   previous:current?.tripId===tripId?current:null,
   current:{tripId,time:timestamp,metres,lon:vehicleCoords[0],lat:vehicleCoords[1]}
  };
 },[tripId,remote.sourceTimestamp,remote.vehicleProgress,vehicleCoords?.[0],vehicleCoords?.[1]]);
 const departureDetection=useDepartureDetection({tripId,stops:trip.stops,raw:trip.raw,gps:compatible?gps:null,
  vehicle:vehicleCoords,vehicleAge:age,paired:compatible,now,baseIndex:remote.index??pos.baseIndex,manualIndex:manual});
 useEffect(()=>{
  if(trip.tripId&&trip.stops.length&&trip.raw)recorder.trip(trip.tripId,trip.stops,trip.raw);
 // Record GTFS once per trip, not once per render.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[trip.tripId,trip.raw,trip.stops.length,recorder.session?.id]);
 const position=manual??(compatible?(departureDetection.phase==='waiting'?remote.index??pos.confirmedIndex??pos.baseIndex:departureDetection.displayIndex):remote.index);
 const current=position!==null?trip.stops[position]:undefined;
 const departure=current?.departure||current?.arrival||'';
 // The departure countdown is ONLY wall-clock time versus the planned GTFS time.
 // LIVE freshness decides which stop is selected, never whether this clock runs.
 const seconds=position!==null&&departure?countdownSeconds(departure,now):null;
 const destination=trip.headsign||'Směr nezjištěn';
 const firstStop=trip.stops[0];
 const firstStopDistance=firstStop&&vehicleCoords&&firstStop.lat!==null&&firstStop.lon!==null?
  distanceMeters(vehicleCoords[1],vehicleCoords[0],firstStop.lat,firstStop.lon):null;
 const firstDeparture=firstStop?countdownSeconds(firstStop.departure||firstStop.arrival,now):null;
 const lifecycle=chosen?stateOf(chosen):'unknown';
 const preparatory=!!chosen&&isBeforeTrip(chosen)&&terminalTrip(chosen,now);
 const firstStopWaiting=!!chosen&&!!firstStop&&
  (remote.vehicleState==='at_stop'||isBeforeTrip(chosen))&&
  (remote.previousIndex===0||remote.nextIndex===0||preparatory)&&
  (remote.previousIndex===0||firstStopDistance===null||firstStopDistance<=200)&&
  firstDeparture!==null&&firstDeparture>-1800&&firstDeparture<=7200;
 // At the origin, at_stop can announce the following stop before actual departure.
 // Prefer the local GPS detector when paired, otherwise wait for on_track.
 const departedRef=useRef<{tripId:string;confirmed:boolean}>({tripId:'',confirmed:false});
 if(departedRef.current.tripId!==tripId)departedRef.current={tripId,confirmed:false};
 if((departureDetection.phase==='left'&&departureDetection.displayIndex!==null&&departureDetection.displayIndex>0)||
    (remote.vehicleState==='on_track'&&remote.nextIndex!==null&&remote.nextIndex>=1)||
    (remote.previousIndex!==null&&remote.previousIndex>=1))departedRef.current.confirmed=true;
 const hasDeparted=departedRef.current.confirmed;
 const terminalWaiting=manual===null&&!hasDeparted&&(preparatory||firstStopWaiting)&&
  !!firstStop&& (isBeforeTrip(chosen!)||lifecycle==='at_stop');
 const remoteProgress=useRemoteProgress({tripId,stops:trip.stops,remote,vehicle:chosen,now,terminalWaiting});
 const terminalName=terminalWaiting?firstStop?.name??null:null;
 const departureEvidence=departureForHandoff({
  remote,progress:remoteProgress,gpsDeparture:departureDetection,
  stopsCount:trip.stops.length,apiAge:age,now,sourceTripState:lifecycle
 });
 useChainHandoff({
  enabled:!trackedService?.verified,active,chosen,plannedHandoff,continuity,nextTrip,trip,tripId,manual,
  displayedIndex:remoteProgress.index,currentTripState:lifecycle,
  handoffFallbackRef,recorder,setLastHandoff,setSelectedTrip,setManual,setExpanded,
  setFeatures,setLastSeen,setLastFetch,setQuery,setActive
 });
 const coreTracking=useCoreDutyTracking(trackedService,token);
 const coreCandidate=coreTracking.decision.candidate;
 const coreKey=trackedService?serviceKey(trackedService):null;
 // The normal per-line 20s poll remains the main data source. The slower
 // fleet-wide poll is only allowed to move us to a DIFFERENT route when the
 // origin+sequence is proved by fresh, unique ACTIVE telemetry.
 useEffect(()=>{
  if(!active||!trackedService?.verified||!coreKey||coreTracking.key!==coreKey||
   !coreCandidate||!token.trim())return;
  if(coreCandidate.route===active[0]&&coreCandidate.order===active[1])return;
  if(coreCandidate.order!==trackedService.sequenceId)return;
  if(Date.now()-coreCandidate.observedAt>90000||coreCandidate.observedAt>Date.now()+10000)return;
  if(selectedTrip||manual!==null)return; // don't interrupt a manual trip/stop
  const nextService=observeService(trackedService,coreCandidate.feature,
   trackedService.serviceDate,coreCandidate.route,coreCandidate.order);
  if(!nextService||serviceKey(nextService)!==coreKey)return;
  const target:[string,string]=[coreCandidate.route,coreCandidate.order];
  const from=active.join('/'),to=target.join('/');
  const reason='Ověřené kmenové pořadí '+trackedService.originRoute+'/'+trackedService.sequenceId+
   ': živý výkon přešel z '+from+' na '+to+'.';
  const coordinates=coreCandidate.feature.geometry?.coordinates;
  const coords=Array.isArray(coordinates)&&coordinates.length>=2?coordinates:null;
  const remembered:LastSeen={
   line:target[0],order:target[1],vehicle:coreCandidate.vehicle,tripId:coreCandidate.tripId,
   lastSeenAt:Date.now(),lastPositionAt:coreCandidate.observedAt,
   lon:coords&&Number.isFinite(Number(coords[0]))?Number(coords[0]):null,
   lat:coords&&Number.isFinite(Number(coords[1]))?Number(coords[1]):null,
   lastStop:'',nextStop:'',state:coreCandidate.state,route:target[0]
  };
  // Persist both identities with the SAME preexisting expiry. Never extend a
  // previous session merely because the current line changed.
  let expires=Date.now()+ACTIVE_TTL;
  try{
   const saved=JSON.parse(stored(ACTIVE_KEY)) as {expires?:number};
   if(saved.expires&&saved.expires>Date.now())expires=saved.expires;
  }catch{/* existing v1 missing */}
  storeTrackedService(nextService,expires);
  save(ACTIVE_KEY,JSON.stringify({line:target[0],order:target[1],expires,
   handoff:{from,to,vehicle:coreCandidate.vehicle,tripId:coreCandidate.tripId,
    reason,time:Date.now()}}));
  saveLastSeen(remembered);saveLastSeenForService(nextService,remembered);
  setTrackedService(nextService);setLastSeen(remembered);
  setLastHandoff({from,to,vehicle:coreCandidate.vehicle,tripId:coreCandidate.tripId,
   reason,time:Date.now()});
  recorder.follow(target[0],target[1],coreCandidate.tripId,reason);
  setSelectedTrip('');setManual(null);setExpanded(false);
  setNeighbourIndex(null);setPinnedAutoNeighbour(null);
  handoffFallbackRef.current=null;
  setFeatures([coreCandidate.feature]);setLastFetch(Date.now());
  setQuery(to);setError('');setActive(target);
 // Deliberately keyed by candidate identity, not every clock render.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[coreTracking.key,coreCandidate?.tripId,coreCandidate?.route,
  coreCandidate?.observedAt,coreKey,active?.[0],active?.[1],selectedTrip,manual]);
 const terminalCountdown=terminalWaiting?firstDeparture:null;
 const displayedIndex=terminalWaiting?0:manual??(compatible?position:remoteProgress.index);
 // Visual identity can switch at the shared boundary without changing the
 // tracked trip. The physical handoff still follows live telemetry.
 const atChainBoundary=!!continuity.ok&&!!plannedHandoff&&!!nextTrip.stops.length&&
  displayedIndex!==null&&displayedIndex>=trip.stops.length-1;
 const visualLine=atChainBoundary?plannedHandoff.next.line:active?.[0]??'';
 const visualOrder=atChainBoundary?(plannedHandoff.next.order||active?.[1]||''):active?.[1]??'';
 const visualDestination=atChainBoundary?nextTrip.headsign||destination:destination;
 // Phase 5B: static platform relevance belongs to the daily GTFS bundle;
 // dynamic telemetry decides when the driver can inspect it safely.
 const autoPlan=useAutoPlatformPlan(tripId,planDate,
  neighbourSettings.enabled&&neighbourSettings.mode!=='off'&&!!active);
 const autoPlatformMarkers=useMemo(()=>autoPlan.ready?
  platformMarkers(trip.stops,autoPlan.entries,autoPlan.stopMap):{},
  [autoPlan.ready,autoPlan.entries,autoPlan.stopMap,trip.stops]);
 const evidence={
  state:remote.vehicleState,previousIndex:remote.previousIndex,nextIndex:remote.nextIndex,
  fresh:remote.status==='confirmed'&&remote.apiAge!==null&&remote.apiAge<=60&&
   remote.sourceAge!==null&&remote.sourceAge<=90
 };
 const liveDelayRaw=path(chosen,'properties.last_position.delay.actual');
 const liveDelaySeconds=typeof liveDelayRaw==='number'&&Number.isFinite(liveDelayRaw)&&
  Math.abs(liveDelayRaw)<3600&&evidence.fresh?liveDelayRaw:0;
 const remainingTo=(index:number)=>{
  const stop=trip.stops[index],scheduled=stop?.arrival||stop?.departure||'';
  const planned=scheduled?countdownSeconds(scheduled,now):null;
  return planned===null?null:planned+liveDelaySeconds;
 };
 // Inspecting a manually selected timetable stop must never masquerade as
 // real tram progress and trigger an unrelated automatic panel.
 const autoTravelIndex=manual===null?displayedIndex:null;
 const autoTarget=autoPlan.ready?pickAutoPlatform({
  stops:trip.stops,currentIndex:autoTravelIndex,entries:autoPlan.entries,
  stopMap:autoPlan.stopMap,evidence,mode:neighbourSettings.mode==='all'?'all':'important',
  remainingToCurrent:autoTravelIndex===null?null:remainingTo(autoTravelIndex),
  remainingToTarget:remainingTo,leadSeconds:neighbourSettings.autoOpenSeconds
 }):null;
 // Resolve the next target ahead of time for static GTFS/peer-history warmup.
 // This does not affect the later automatic OPEN threshold.
 const autoPrefetchTarget=autoPlan.ready?pickAutoPlatform({
  stops:trip.stops,currentIndex:autoTravelIndex,entries:autoPlan.entries,
  stopMap:autoPlan.stopMap,evidence,mode:neighbourSettings.mode==='all'?'all':'important',
  remainingToCurrent:null,remainingToTarget:remainingTo,
  leadSeconds:neighbourSettings.autoOpenSeconds,prefetchOnly:true
 }):null;
 const autoNeighbourReady=autoTarget!==null;
 // Adjacent joining stops: change target only once actual arrival at the
 // previous joined platform is confirmed. Otherwise keep the existing panel.
 const transferAuto=pinnedAutoNeighbour?.tripId===tripId&&autoTarget!==null&&
  autoTarget.index===pinnedAutoNeighbour.index+1&&
  confirmedAtStop(evidence,pinnedAutoNeighbour.index);
 const pinnedStillActive=pinnedAutoNeighbour?.tripId===tripId&&
  !confirmedBeyondStop(evidence,pinnedAutoNeighbour.index);
 const effectivePinnedAutoIndex=pinnedStillActive?pinnedAutoNeighbour!.index:null;
 const effectiveAutoNeighbourIndex=transferAuto?autoTarget!.index:
  effectivePinnedAutoIndex??autoTarget?.index??autoPrefetchTarget?.index??displayedIndex;
 const stopNeighbours=useStopNeighbours({
  enabled:neighbourSettings.enabled&&!!active,token:token.trim(),now,
  ownFeature:chosen,ownTripId:tripId,stops:trip.stops,rawTrip:trip.raw,knownFeatures:features,staticDate:planDate,currentIndex:displayedIndex,
  requestedIndex:neighbourIndex??effectiveAutoNeighbourIndex,settings:neighbourSettings
 });
 const highlightedStop=displayedIndex!==null?trip.stops[displayedIndex]:undefined;
 const highlightedTime=highlightedStop?.departure||highlightedStop?.arrival||'';
 const highlightedRemaining=terminalWaiting?terminalCountdown:
  !compatible&&manual===null&&remoteProgress.predicted?
   countdownSeconds(highlightedTime,now):seconds;
 const telemetryAge=remote.sourceAge;
 const statusColor=!chosen?'statusGray':error||age===null||age>90?'statusRed':
  !compatible&&remoteProgress.predicted?'statusAmber':
  telemetryAge===null?'statusGray':telemetryAge<=30?'statusGreen':telemetryAge<=90?'statusAmber':'statusRed';
 const statusDescription=!chosen?'Vůz není aktuálně nalezen':error?'Chyba připojení':
  !compatible&&remoteProgress.predicted?'Zastávka je predikovaná podle posledního hlášení':
  telemetryAge===null?'Čas měření polohy není dostupný':
  'Stáří polohy '+telemetryAge+' sekund';
 useEffect(()=>{
  const recordActive=recorder.session?.state==='recording'&&active&&(
   recorder.session.target.line===active[0]&&recorder.session.target.order===active[1]||
   recorder.session.aliases?.includes(active.join('/')));
  if(!recordActive){lastDecisionRef.current='';return;}
  const summary={tripId,vehicle:chosen?vehicleId(chosen):null,queryMode,
   mode:onboard.mode,paired:compatible,gap:onboard.gap,routeGap:onboard.routeGap,
   reason:onboard.reason,remoteSource:remote.source,remoteState:remote.status,
   vehicleState:remote.vehicleState,lastStopSequence:remote.previousIndex===null?null:trip.stops[remote.previousIndex]?.sequence??null,
   nextStopSequence:remote.nextIndex===null?null:trip.stops[remote.nextIndex]?.sequence??null,
   currentIndex:displayedIndex,stopName:highlightedStop?.name??null,remotePrediction:remoteProgress.predicted,
   predictionReason:remoteProgress.reason,predictionAgeSeconds:remoteProgress.atStopAge,
   predictionThresholdSeconds:remoteProgress.threshold,departurePhase:departureDetection.phase,
   departureLastSwitch:departureDetection.lastSwitch,terminalWaiting,terminalName,
   sourceAgeSeconds:remote.sourceAge};
  const signature=JSON.stringify({...summary,gap:null,routeGap:null,sourceAgeSeconds:null,reason:null});
  if(lastDecisionRef.current===signature)return;
  lastDecisionRef.current=signature;
  recordDecisionRef.current(summary);
 // State transitions only: no event on every clock tick or GPS metre.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[recorder.session?.id,recorder.session?.state,tripId,chosen,queryMode,onboard.mode,
    compatible,remote.source,remote.status,remote.vehicleState,remote.previousIndex,
    remote.nextIndex,displayedIndex,remoteProgress.predicted,departureDetection.phase,departureDetection.lastSwitch,terminalWaiting]);
 function start(value=query){
  const parsed=parseOrder(value);if(!parsed){setError('Zadej linku a pořadí, například 25/5.');return;}
  if(!token.trim()){setSettings(true);setError('Nejdřív vlož API klíč v Nastavení.');return;}
  setQuery(parsed[0]+'/'+parsed[1]);
  const selected=results.find(item=>item.line===parsed[0]&&item.order===parsed[1]&&!item.ambiguous);
  const observed=selected?lookup.items.find(item=>selectedTripId(item)===selected.target.tripId&&
   routeOf(item)===parsed[0]):null;
  const date=operatingDate(Date.now());
  const initial=observed?serviceFromFeature(observed,date):null;
  const nextService=initial??unverifiedService(parsed[0],parsed[1],date);
  setTrackedService(nextService);
  storeTrackedService(nextService);

  setNeighbourIndex(null);setSelectedTrip('');setManual(null);setExpanded(false);setEditing(false);setLastHandoff(null);handoffFallbackRef.current=null;
  // Reuse the already retrieved line snapshot immediately on selection.
  // The running timer shares its Golemio URL and its 20-second cache.
  const immediate=lookup.items.filter(item=>routeOf(item)===parsed[0]);
  if(immediate.length){
   setFeatures(immediate);setLastFetch(Date.now());
  }else{
   setFeatures([]);setLastFetch(null);
  }
  setError('');
  save(ACTIVE_KEY,JSON.stringify({line:parsed[0],order:parsed[1],expires:Date.now()+ACTIVE_TTL}));
  setActive(parsed);
 }
 function forget(){
  setTrackedService(null);storeTrackedService(null);
  setNeighbourIndex(null);
  setRememberToken(false);setToken('');save(TOKEN_KEY,'');save(ACTIVE_KEY,'');setActive(null);setFeatures([]);setSelectedTrip('');setLastHandoff(null);handoffFallbackRef.current=null;setSettings(false);
 }
 function chooseTrip(id:string){setNeighbourIndex(null);setSelectedTrip(id);setManual(null);}
 return {trackedService,coreTracking,neighbourSettings,updateNeighbourSettings,neighbourIndex,setNeighbourIndex,autoNeighbourIndex:effectiveAutoNeighbourIndex,autoNeighbourReady,autoTargetIndex:autoTarget?.index??null,autoPlatformMarkers,autoPhysicalStopMap:autoPlan.stopMap,autoTransfer:transferAuto,autoEvidence:evidence,pinnedStillActive,pinnedAutoNeighbour,setPinnedAutoNeighbour,stopNeighbours,showHeadways,setShowHeadways,submitLookup,resetLookup,lookupConfirmed,plannedHeadways,plannedLiveHeadways,peerFeatures:peerPositions.features,peerTripIds:peerPositions.tripIds,peerPositionUpdatedAt:peerPositions.updatedAt,peerPositionLoading:peerPositions.loading,peerPhases:peerPositions.phases,planDate,now,peerPositionStatus:peerPositions.status,visualLine,visualOrder,visualDestination,atChainBoundary,token,setToken,rememberToken,setRememberToken,tokenVisible,setTokenVisible,settings,setSettings,query,setQuery,active,diagnostics,setDiagnostics,selectedTrip,manual,setManual,expanded,setExpanded,editing,setEditing,features,lookup,lastFetch,queryMode,lastSeen,relatedVehicle,lastHandoff,terminalCandidates,loading,error,setError,gpsWanted,setGpsWanted,gps,gpsError,gpsAge,pos,toggleGPS,lookupLine,lookupOrder,queryKind,queryVehicle,results,lookupReady,searchingAcrossRoutes,stopNames,start,forget,chooseTrip,matches,chosen,trip,tripId,nextTrip,previousTrip,previousPartner,plannedHandoff,continuity,age,nextStopId,departureDetection,remote,onboard,compatible,position,destination,terminalWaiting,terminalName,displayedIndex,highlightedStop,highlightedRemaining,statusColor,statusDescription,chainDiagnostic,departureEvidence,remoteProgress,recorder};
}
