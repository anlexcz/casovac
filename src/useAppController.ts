import {useEffect,useRef,useState,useMemo} from 'react';
import {selectTrip,isBeforeTrip,stateOf,terminalTrip} from './tripSelection';
import {useTripData,countdownSeconds} from './tripData';
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
import {readLastSeen,extractRecordedVehicle} from './lastSeen';
import type {LastSeen} from './lastSeen';
import {path,text,selectedTripId,vehicleId} from './featureUtils';
import {useChainHandoff} from './useChainHandoff';
import type {Feature} from './featureUtils';
import {useVehicleTracking} from './useVehicleTracking';
import {useGpsTracking} from './useGpsTracking';
import {calculateLineHeadways} from './lineHeadways';
import {useHeadwayTimetables} from './useHeadwayTimetables';
import {useStopNeighbours} from './useStopNeighbours';
import {DEFAULT_NEIGHBOUR_SETTINGS} from './stopNeighbours';
import type {NeighbourSettings} from './stopNeighbours';
export {vehicleId} from './featureUtils';


import {TOKEN_KEY,ROUTE_KEY,ACTIVE_KEY,ACTIVE_TTL,recentTracking,stored,save} from './trackingStorage';
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
 const [diagnostics,setDiagnostics]=useState(false);
 const [showHeadways,setShowHeadways]=useState(()=>stored('casovac:show-headways:v1')==='true');
 const [neighbourSettings,setNeighbourSettings]=useState<NeighbourSettings>(()=>{
  try{
   const json=JSON.parse(stored('casovac:neighbour-settings:v1')) as Partial<NeighbourSettings>;
   return {...DEFAULT_NEIGHBOUR_SETTINGS,...json};
  }catch{return DEFAULT_NEIGHBOUR_SETTINGS;}
 });
 const [neighbourIndex,setNeighbourIndex]=useState<number|null>(null);
 useEffect(()=>{save('casovac:neighbour-settings:v1',JSON.stringify(neighbourSettings));},[neighbourSettings]);
 const updateNeighbourSettings=(patch:Partial<NeighbourSettings>)=>
  setNeighbourSettings(old=>({...old,...patch}));

 useEffect(()=>{save('casovac:show-headways:v1',showHeadways?'true':'false');},[showHeadways]);
 const [selectedTrip,setSelectedTrip]=useState('');
 const [manual,setManual]=useState<number|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [editing,setEditing]=useState(false);
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
 const {lookup,lookupLine,lookupOrder,results,lookupReady,stopNames}=useOrderLookup(query,editing,token,now);
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


 const {features,setFeatures,lastFetch,setLastFetch,queryMode,relatedVehicle,terminalCandidates,loading}=useVehicleTracking({active,token,recorder,gps,setLastSeen,setError,handoffFallbackRef});


 const resolved=active?selectTrip(features,active[0],active[1],now,lastSeen?.vehicle):null;
 const matches=resolved?.matches??[];
 const candidateFeature=selectedTrip?features.find(f=>selectedTripId(f)===selectedTrip)??null:resolved?.feature??null;
 const chosen=candidateFeature;
 const tripId=chosen?selectedTripId(chosen):'';
 const trip=useTripData(tripId,token.trim());
 const {chainDiagnostic,plannedHandoff,nextTrip,previousTrip,previousPartner,continuity}=useChainTracking({
  active,chosen,lastSeen,features,token,tripId,trip,selectedTrip,recordChain:recorder.chain
 });
 const verifiedCompanion=continuity.ok?
  plannedHandoff?.next??previousPartner:null;
 const headwaySource=useHeadwayTimetables({
  enabled:showHeadways&&!!active,selected:chosen,features,currentStops:trip.stops,
  token:token.trim(),now,
  companionLine:verifiedCompanion?.line??'',
  companionTripId:verifiedCompanion?.tripId??''
 });
 const headways=useMemo(()=>showHeadways?
  calculateLineHeadways({selected:chosen,features:headwaySource.features,stops:trip.stops,
   peerStops:headwaySource.schedules,allowedRoutes:headwaySource.allowedRoutes,now}):null,
  [showHeadways,chosen,headwaySource.features,trip.stops,headwaySource.schedules,
   headwaySource.allowedRoutes,Math.floor(now/30000)]);
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
 const seconds=age!==null&&age<50&&position!==null&& (compatible||remote.status!=='stale'&&remote.status!=='off-route')?countdownSeconds(departure,now):null;
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
  active,chosen,plannedHandoff,continuity,nextTrip,trip,tripId,manual,
  displayedIndex:remoteProgress.index,currentTripState:lifecycle,
  handoffFallbackRef,recorder,setLastHandoff,setSelectedTrip,setManual,setExpanded,
  setFeatures,setLastSeen,setLastFetch,setQuery,setActive
 });
 const terminalCountdown=terminalWaiting?firstDeparture:null;
 const displayedIndex=terminalWaiting?0:manual??(compatible?position:remoteProgress.index);
 // Visual identity can switch at the shared boundary without changing the
 // tracked trip. The physical handoff still follows live telemetry.
 const atChainBoundary=!!continuity.ok&&!!plannedHandoff&&!!nextTrip.stops.length&&
  displayedIndex!==null&&displayedIndex>=trip.stops.length-1;
 const visualLine=atChainBoundary?plannedHandoff.next.line:active?.[0]??'';
 const visualOrder=atChainBoundary?(plannedHandoff.next.order||active?.[1]||''):active?.[1]??'';
 const visualDestination=atChainBoundary?nextTrip.headsign||destination:destination;
 // Prepare the next shared platform before reaching its junction.
 // The detection uses the current live deviation but never changes the
 // timetable-based ordering of other vehicles.
 const nextNeighbourIndex=displayedIndex===null?null:
  displayedIndex+1<trip.stops.length?displayedIndex+1:null;
 const nextNeighbourStop=nextNeighbourIndex===null?null:trip.stops[nextNeighbourIndex];
 const nextNeighbourSchedule=nextNeighbourStop?.arrival||nextNeighbourStop?.departure||'';
 const liveDelayRaw=path(chosen,'properties.last_position.delay.actual');
 const liveDelaySeconds=typeof liveDelayRaw==='number'&&Number.isFinite(liveDelayRaw)&&Math.abs(liveDelayRaw)<3600?liveDelayRaw:0;
 const nextNeighbourCountdown=nextNeighbourSchedule?countdownSeconds(nextNeighbourSchedule,now):null;
 const nextNeighbourEta=nextNeighbourCountdown===null?null:nextNeighbourCountdown+liveDelaySeconds;
 const autoNeighbourReady=nextNeighbourEta!==null&&nextNeighbourEta>=-30&&
  nextNeighbourEta<=neighbourSettings.autoOpenSeconds;
 // Start loading online stop data earlier than the sheet animation.
 const autoNeighbourIndex=nextNeighbourIndex!==null&&nextNeighbourEta!==null&&
  nextNeighbourEta>=-30&&nextNeighbourEta<=Math.max(180,neighbourSettings.autoOpenSeconds+90)?
   nextNeighbourIndex:displayedIndex;
 const stopNeighbours=useStopNeighbours({
  enabled:neighbourSettings.enabled&&!!active,token:token.trim(),now,
  ownFeature:chosen,ownTripId:tripId,stops:trip.stops,knownFeatures:features,currentIndex:displayedIndex,
  requestedIndex:neighbourIndex??autoNeighbourIndex,settings:neighbourSettings
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
  setNeighbourIndex(null);setSelectedTrip('');setManual(null);setExpanded(false);setEditing(false);setLastHandoff(null);handoffFallbackRef.current=null;
  // Reuse the already retrieved line snapshot immediately on selection.
  // The running timer shares its Golemio URL and its 20-second cache.
  if(lookup.line===parsed[0]&&lookup.items.length){
   setFeatures(lookup.items);setLastFetch(Date.now());
  }else{
   setFeatures([]);setLastFetch(null);
  }
  setError('');
  save(ACTIVE_KEY,JSON.stringify({line:parsed[0],order:parsed[1],expires:Date.now()+ACTIVE_TTL}));
  setActive(parsed);
 }
 function forget(){
  setNeighbourIndex(null);
  setRememberToken(false);setToken('');save(TOKEN_KEY,'');save(ACTIVE_KEY,'');setActive(null);setFeatures([]);setSelectedTrip('');setLastHandoff(null);handoffFallbackRef.current=null;setSettings(false);
 }
 function chooseTrip(id:string){setNeighbourIndex(null);setSelectedTrip(id);setManual(null);}
 return {neighbourSettings,updateNeighbourSettings,neighbourIndex,setNeighbourIndex,autoNeighbourIndex,autoNeighbourReady,stopNeighbours,showHeadways,setShowHeadways,headways,visualLine,visualOrder,visualDestination,atChainBoundary,token,setToken,rememberToken,setRememberToken,tokenVisible,setTokenVisible,settings,setSettings,query,setQuery,active,diagnostics,setDiagnostics,selectedTrip,manual,setManual,expanded,setExpanded,editing,setEditing,features,lookup,lastFetch,queryMode,lastSeen,relatedVehicle,lastHandoff,terminalCandidates,loading,error,setError,gpsWanted,setGpsWanted,gps,gpsError,gpsAge,pos,toggleGPS,lookupLine,lookupOrder,results,lookupReady,stopNames,start,forget,chooseTrip,matches,chosen,trip,tripId,nextTrip,previousTrip,previousPartner,plannedHandoff,continuity,age,nextStopId,departureDetection,remote,onboard,compatible,position,destination,terminalWaiting,terminalName,displayedIndex,highlightedStop,highlightedRemaining,statusColor,statusDescription,chainDiagnostic,departureEvidence,remoteProgress,recorder};
}
