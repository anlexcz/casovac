import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Diagnostics from './Diagnostics';
import StopBoard from './StopBoard';
import {selectTrip,isBeforeTrip,stateOf,terminalTrip} from './tripSelection';
import {useTripData,countdownSeconds} from './tripData';
import {useChooserStops,chooserStop} from './chooserStops';
import type {ChooserTarget} from './chooserStops';
import {golemioJson} from './golemioClient';
import {useChainDiagnostics} from './chainDiagnostics';
import {findPlannedHandoff,verifyHandoffStops,departureForHandoff} from './chainHandoff';
import {usePosition} from './position';
import {useDepartureDetection} from './departure';
import {useRecorder} from './recorder';
import {remoteEstimate} from './remoteTracking';
import {useRemoteProgress} from './remoteProgress';
import type {RemoteHistory} from './remoteTracking';
import {distanceMeters} from './position';
import {useOnboardMode} from './onboard';
import {readLastSeen,saveLastSeen,extractRecordedVehicle} from './lastSeen';
import type {LastSeen} from './lastSeen';
import {observationTimestamp} from './remoteTracking';
import type {GpsFix} from './position';
import './style.css';
import './typography.css';

type Obj=Record<string,unknown>;
type Feature={properties?:Obj;geometry?:{coordinates?:unknown}};
const API='https://api.golemio.cz/v2/vehiclepositions';
const TOKEN_KEY='casovac:golemio-token:v1';
const ROUTE_KEY='casovac:last-order:v1';
const GPS_KEY='casovac:gps-preferred:v1';
const ACTIVE_KEY='casovac:active-order:v1';
const ACTIVE_TTL=4*60*60*1000;
const recentTracking=():[string,string]|null=>{try{
 const raw=localStorage.getItem(ACTIVE_KEY);if(!raw)return null;
 const v=JSON.parse(raw) as {line?:string;order?:string;expires?:number};
 if(!v?.expires||v.expires<Date.now()||!/^\d{1,3}$/.test(v.line??'')||!/^\d{1,4}$/.test(v.order??'')){
  localStorage.removeItem(ACTIVE_KEY);return null;
 }
 return [v.line!,v.order!];
 }catch{return null;}};
const stored=(key:string):string=>{try{return localStorage.getItem(key)??'';}catch{return '';}};
const save=(key:string,value:string)=>{try{if(value)localStorage.setItem(key,value);else localStorage.removeItem(key);return true;}catch{return false;}};
const path=(obj:unknown,p:string):unknown=>p.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Obj)[k]:undefined,obj);
const text=(value:unknown):string=>value===undefined||value===null?'—':String(value);
const selectedTripId=(f:Feature)=>text(path(f,'properties.trip.gtfs.trip_id')??path(f,'properties.trip.trip_id'));
const vehicleId=(f:Feature)=>text(path(f,'properties.trip.vehicle_registration_number')??path(f,'properties.trip.vehicle.id')??path(f,'properties.trip.vehicle_id'));
const orderOf=(f:Feature)=>path(f,'properties.trip.sequence_id')??path(f,'properties.trip.cis.order')??path(f,'properties.trip.order')??path(f,'properties.trip.gtfs.run_number');
const normalize=(v:unknown)=>String(v??'').replace(/^0+/,'')||'0';
const parseOrder=(q:string):[string,string]|null=>{
 const match=/^(\d{1,3})\s*\/\s*(\d{1,4})$/.exec(q.trim());
 return match?[match[1],match[2]]:null;
};
function App(){
 const [token,setToken]=useState(()=>stored(TOKEN_KEY));
 const [rememberToken,setRememberToken]=useState(()=>!!stored(TOKEN_KEY));
 const [tokenVisible,setTokenVisible]=useState(false);
 const [settings,setSettings]=useState(false);
 const [query,setQuery]=useState(()=>stored(ROUTE_KEY));
 const [active,setActive]=useState<[string,string]|null>(()=>stored(TOKEN_KEY)?recentTracking():null);
 const [diagnostics,setDiagnostics]=useState(false);
 const [selectedTrip,setSelectedTrip]=useState('');
 const [manual,setManual]=useState<number|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [editing,setEditing]=useState(false);
 const [features,setFeatures]=useState<Feature[]>([]);
 const [lookup,setLookup]=useState<{line:string;items:Feature[];error:string;loading:boolean}>({line:'',items:[],error:'',loading:false});
 const [lastFetch,setLastFetch]=useState<number|null>(null);
 const [queryMode,setQueryMode]=useState('active');
 const [lastSeen,setLastSeen]=useState<LastSeen|null>(null);
 const [relatedVehicle,setRelatedVehicle]=useState<{vehicle:string;route:string;order:string;state:string;time:number}|null>(null);
 const [lastHandoff,setLastHandoff]=useState<{from:string;to:string;vehicle:string;tripId:string;reason:string;time:number}|null>(()=>{
  try{
   const saved=JSON.parse(stored(ACTIVE_KEY)) as {line?:string;order?:string;expires?:number;handoff?:{from:string;to:string;vehicle:string;tripId:string;reason:string;time:number}};
   const handoff=saved.handoff;
   return saved.expires&&saved.expires>Date.now()&&handoff&&handoff.to===saved.line+'/'+saved.order?handoff:null;
  }catch{return null;}
 });
 const previousScanRef=useRef(0);
 const [terminalCandidates,setTerminalCandidates]=useState<unknown[]>([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [now,setNow]=useState(Date.now());
 const [gpsWanted,setGpsWanted]=useState(()=>stored(GPS_KEY)==='1');
 const [gps,setGps]=useState<GpsFix|null>(null);
 const [gpsError,setGpsError]=useState('');
 const requestRef=useRef(0);
 const handoffFallbackRef=useRef<{target:string;vehicle:string;feature:Feature;until:number}|null>(null);
 const recorder=useRecorder();
 const gpsRef=useRef<GpsFix|null>(null);
 gpsRef.current=gps;
 const recordApiRef=useRef(recorder.api);recordApiRef.current=recorder.api;
 const recordErrorRef=useRef(recorder.apiError);recordErrorRef.current=recorder.apiError;
 const recordGpsRef=useRef(recorder.gps);recordGpsRef.current=recorder.gps;
 const recordDecisionRef=useRef(recorder.decision);recordDecisionRef.current=recorder.decision;
 const lastDecisionRef=useRef('');
 const historyRef=useRef<{previous:RemoteHistory|null;current:RemoteHistory|null}>({previous:null,current:null});

 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{save(ROUTE_KEY,query.trim());},[query]);
 const lookupLine=/^\d{1,3}(?:\s*\/\s*\d{0,4})?$/.test(query.trim())?query.trim().split('/')[0].trim():'';
 useEffect(()=>{
  if(!editing||!lookupLine||!token.trim())return;
  let alive=true;const abort=new AbortController();
  async function load(){
   setLookup(previous=>({line:lookupLine,items:previous.line===lookupLine?previous.items:[],error:'',loading:true}));
   try{
    const url=new URL(API);url.searchParams.set('routeShortName',lookupLine);
    url.searchParams.set('includeNotTracking','true');url.searchParams.set('limit','1000');
    const body:unknown=await golemioJson<unknown>(url.toString(),token.trim(),20000);
    if(!body||typeof body!=='object'||!Array.isArray((body as Obj).features))throw Error('Neplatná odpověď');
    if(alive)setLookup({line:lookupLine,items:(body as {features:Feature[]}).features,error:'',loading:false});
   }catch(e){if(alive&&!abort.signal.aborted)setLookup(previous=>({
    line:lookupLine,items:previous.line===lookupLine?previous.items:[],
    error:e instanceof Error?e.message:String(e),loading:false
   }));}
  }
  const delay=setTimeout(()=>void load(),250),interval=setInterval(()=>void load(),45000);
  return()=>{alive=false;abort.abort();clearTimeout(delay);clearInterval(interval);};
 },[editing,lookupLine,token]);
 const available=new Map<string,{line:string;order:string;car:string;target:ChooserTarget}>();
 if(lookup.line===lookupLine){
  const groups=new Map<string,Feature[]>();
  for(const f of lookup.items){
   const line=String(path(f,'properties.trip.gtfs.route_short_name')??path(f,'properties.trip.route_short_name')??'');
   const raw=orderOf(f);
   if(normalize(line)!==normalize(lookupLine)||raw===null||raw===undefined||!/^\d+$/.test(String(raw)))continue;
   const key=normalize(line)+'/'+normalize(raw);
   groups.set(key,[...(groups.get(key)??[]),f]);
  }
  for(const [key,items] of groups){
   const [line,order]=key.split('/');
   const chosen=selectTrip(items,line,order,now).feature??items[0];
   const car=vehicleId(chosen);
   const state=stateOf(chosen);
   const next=path(chosen,'properties.last_position.next_stop');
   const last=path(chosen,'properties.last_position.last_stop');
   const nextObj=next&&typeof next==='object'?next as Obj:null;
   const nextId=String(nextObj?.id??(typeof next==='string'?next:''));
   const seq=nextObj?.sequence;
   const future=items.filter(f=>vehicleId(f)===car&&stateOf(f).startsWith('before_track'))
    .sort((a,b)=>Number(path(a,'properties.trip.start_timestamp')??0)-Number(path(b,'properties.trip.start_timestamp')??0))[0];
   const atTerminal=state.startsWith('after_track')||state.startsWith('before_track')||(!next&&!!future);
   const rawName=nextObj?.name??(last&&typeof last==='object'?(last as Obj).name:undefined);
   const target:ChooserTarget={
    tripId:selectedTripId(chosen),fallbackTripId:future?selectedTripId(future):'',
    nextId,nextSequence:seq!==undefined&&seq!==null&&Number.isFinite(Number(seq))?Number(seq):null,
    directName:typeof rawName==='string'?rawName:'',atTerminal
   };
   available.set(key,{line,order,car,target});
  }
 }
 const stopNames=useChooserStops([...available.values()].map(v=>v.target),token.trim(),editing&&!!lookupLine);
 const lookupOrder=parseOrder(query);
 const results=[...available.values()].filter(item=>!lookupOrder||normalize(item.order)===normalize(lookupOrder[1])).sort((a,b)=>Number(a.order)-Number(b.order));
 const lookupReady=lookup.line===lookupLine&&!lookup.loading;
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
 useEffect(()=>{
  save(GPS_KEY,gpsWanted?'1':'');
  if(!gpsWanted){setGps(null);setGpsError('');return;}
  if(!navigator.geolocation){setGpsError('Geolokace není v prohlížeči dostupná.');return;}
  let alive=true;
  const watch=navigator.geolocation.watchPosition(
   p=>{if(alive){const fix={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,speed:p.coords.speed,timestamp:p.timestamp};setGps(fix);recordGpsRef.current(fix);setGpsError('');}},
   e=>{if(alive){setGps(null);setGpsError(e.message);}},
   {enableHighAccuracy:true,maximumAge:5000,timeout:20000}
  );
  return()=>{alive=false;navigator.geolocation.clearWatch(watch);};
 },[gpsWanted]);

 useEffect(()=>{
  if(!active||!token.trim())return;
  const controller=new AbortController();let alive=true;let busy=false;
  const generation=++requestRef.current;
  async function refresh(){
   if(busy||!alive)return;busy=true;setLoading(true);
   const requestStartedAt=Date.now();
   try{
    const url=new URL(API);url.searchParams.set('routeShortName',active![0]);url.searchParams.set('limit','1000');
    url.searchParams.set('includeNotTracking','true');
    const data:unknown=await golemioJson<unknown>(url.toString(),token.trim(),12000);
    if(!alive||controller.signal.aborted)return;
    if(!data||typeof data!=='object'||!Array.isArray((data as Obj).features))throw Error('Neplatná odpověď živých poloh');
    if(alive&&generation===requestRef.current){
     const standard=(data as {features:Feature[]}).features;
     let fetched=standard;
     // Keep the prepared successor visible while Golemio still reports the old line.
     // Never treat this cached object as a fresh observation.
     const fallback=handoffFallbackRef.current;
     if(fallback&&fallback.target===active!.join('/')&&Date.now()<fallback.until){
      const liveSameOrder=standard.some(f=>normalize(orderOf(f))===normalize(active![1])&&
       String(path(f,'properties.trip.gtfs.route_short_name')??'')===active![0]&&
       (stateOf(f)==='at_stop'||stateOf(f)==='on_track'));
      if(!liveSameOrder)fetched=[...standard,fallback.feature];
      else handoffFallbackRef.current=null;
     }else if(fallback&&fallback.target===active!.join('/'))handoffFallbackRef.current=null;
     let selectedResult=selectTrip(fetched,active![0],active![1],Date.now(),
      readLastSeen(active![0],active![1])?.vehicle);
     let matching=selectedResult.matches;
     let queryMode='includeNotTracking';
     // If we have previously identified the physical car but the line/order
     // disappears during terminal layover, look for that exact car across routes.
     // Never mistake an unrelated car with the same order for a match.
     const known=readLastSeen(active![0],active![1])??
      extractRecordedVehicle(recorder.session,active![0],active![1]);
     let related:{vehicle:string;route:string;order:string;state:string;time:number}|null=null;
     if(!matching.length&&known?.vehicle&&Date.now()-previousScanRef.current>=60000){
      previousScanRef.current=Date.now();
      try{
       const globalUrl=new URL(API);
       globalUrl.searchParams.set('includeNotTracking','true');
       globalUrl.searchParams.set('limit','3000');
       const body:unknown=await golemioJson<unknown>(globalUrl.toString(),token.trim(),30000);
       if(!controller.signal.aborted){
        const all=body&&typeof body==='object'&&Array.isArray((body as Obj).features)?
         (body as {features:Feature[]}).features:[];
        const sameCar=all.filter(item=>vehicleId(item)===known.vehicle);
        if(sameCar.length===1){
         const car=sameCar[0];
         const carRoute=String(path(car,'properties.trip.gtfs.route_short_name')??path(car,'properties.trip.route_short_name')??'');
         const carOrder=String(orderOf(car)??'');
         related={vehicle:known.vehicle,route:carRoute,order:carOrder,
          state:String(path(car,'properties.last_position.state_position')??''),
          time:Date.now()};
         if(carRoute===active![0]&&normalize(carOrder)===normalize(active![1])){
          fetched=[...fetched,car];matching=[car];queryMode='knownVehicle';
         }else queryMode='knownVehicleOnOtherTrip';
        }else queryMode='globalScanNoMatch';
       }
      }catch(e){if(controller.signal.aborted)throw e;queryMode='globalScanError';}
     }
     if(related)setRelatedVehicle(related);
     // The initial response and its non-tracking fallback are kept separate for
     // diagnostics: a vehicle may exist in one but not in the other.
     const terminalCandidatesFound=fetched.map(feature=>({
       order:orderOf(feature),vehicle:vehicleId(feature),tripId:selectedTripId(feature),
       state:path(feature,'properties.last_position.state_position'),
       nextStop:path(feature,'properties.last_position.next_stop'),
       start:path(feature,'properties.trip.start_timestamp')
     }));
     selectedResult=selectTrip(fetched,active![0],active![1],Date.now(),known?.vehicle);
     const proposed=selectedResult.feature;
     const selected=proposed;
     const candidates=!selected?fetched.map(feature=>({
       order:orderOf(feature),vehicle:vehicleId(feature),tripId:selectedTripId(feature),
       route:path(feature,'properties.trip.gtfs.route_short_name'),state:path(feature,'properties.last_position.state_position'),
       tracking:path(feature,'properties.last_position.tracking'),
       start:path(feature,'properties.trip.start_timestamp'),
       nextStop:path(feature,'properties.last_position.next_stop'),
       lastStop:path(feature,'properties.last_position.last_stop')
     })):null;
     recordApiRef.current({line:active![0],order:active![1],responseStatus:200,
      requestStartedAt,responseAt:Date.now(),matchingCount:matching.length,vehicle:selected,gps:gpsRef.current,
      source:selected?(selected===handoffFallbackRef.current?.feature?'handoff_pending':'unique_order'):'ambiguous_or_missing',candidateVehicles:candidates,queryMode});
     if(selected&&selected!==handoffFallbackRef.current?.feature){
      const loc=selected.geometry?.coordinates;
      const coords=Array.isArray(loc)&&loc.length>=2?loc:null;
      const p=path(selected,'properties.last_position') as Obj|undefined;
      const value:LastSeen={line:active![0],order:active![1],vehicle:vehicleId(selected),
       tripId:selectedTripId(selected),lastSeenAt:Date.now(),lastPositionAt:observationTimestamp(selected),
       lon:coords&&Number.isFinite(Number(coords[0]))?Number(coords[0]):null,
       lat:coords&&Number.isFinite(Number(coords[1]))?Number(coords[1]):null,
       lastStop:String(path(p,'last_stop.name')??''),nextStop:String(path(p,'next_stop.name')??''),
       state:String(path(p,'state_position')??''),
       route:String(path(selected,'properties.trip.gtfs.route_short_name')??active![0])};
      if(value.vehicle!=='—'){saveLastSeen(value);setLastSeen(value);}
      setRelatedVehicle(null);
     }
     setFeatures(fetched);setQueryMode(queryMode);setTerminalCandidates(terminalCandidatesFound);setLastFetch(Date.now());setError('');
    }
   }catch(e){if(alive&&!controller.signal.aborted){const message=e instanceof Error?e.message:String(e);setError(message);recordErrorRef.current(active![0],active![1],'fetch_error',message);}}
   finally{busy=false;if(alive)setLoading(false);}
  }
  void refresh();const timer=setInterval(()=>void refresh(),20000);
  return()=>{alive=false;clearInterval(timer);controller.abort();};
 },[active,token]);

 const resolved=active?selectTrip(features,active[0],active[1],now,lastSeen?.vehicle):null;
 const matches=resolved?.matches??[];
 const candidateFeature=selectedTrip?features.find(f=>selectedTripId(f)===selectedTrip)??null:resolved?.feature??null;
 const chosen=candidateFeature;
 const chainRecordRef=useRef(recorder.chain);
 chainRecordRef.current=recorder.chain;
 const chainRecord=useRef((value:unknown)=>{
  const target=chainTargetRef.current;
  if(target)chainRecordRef.current(target[0],target[1],value);
 }).current;
 const chainTargetRef=useRef<[string,string]|null>(active);
 chainTargetRef.current=active;
 const chainDiagnostic=useChainDiagnostics({
  active,knownVehicle:chosen?vehicleId(chosen):lastSeen?.vehicle??'',
  token:token.trim(),
  enabled:!!active&&['5','6','9','10'].includes(active[0]),
  primaryFeatures:features,record:chainRecord
 });
 const tripId=chosen?selectedTripId(chosen):'';
 const trip=useTripData(tripId,token.trim());
 const plannedHandoff=active&&chosen&&selectedTrip===''?
  findPlannedHandoff(chainDiagnostic,{
   line:active[0],order:active[1],tripId,vehicle:vehicleId(chosen),
   start:path(chosen,'properties.trip.start_timestamp')
  },now):null;
 const nextTrip=useTripData(plannedHandoff?.next.tripId??'',token.trim());
 const continuity=plannedHandoff?verifyHandoffStops(trip.stops,nextTrip.stops):
  {ok:false,reason:'Navazující trip zatím nebyl nalezen.'};
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
  // Prepared trip comes from the other line's live vehicle snapshot.
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
 const terminalCountdown=terminalWaiting?firstDeparture:null;
 const displayedIndex=terminalWaiting?0:manual??(compatible?position:remoteProgress.index);
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
  setSelectedTrip('');setManual(null);setExpanded(false);setEditing(false);setLastHandoff(null);handoffFallbackRef.current=null;
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
  setRememberToken(false);setToken('');save(TOKEN_KEY,'');save(ACTIVE_KEY,'');setActive(null);setFeatures([]);setSelectedTrip('');setLastHandoff(null);handoffFallbackRef.current=null;setSettings(false);
 }
 function chooseTrip(id:string){setSelectedTrip(id);setManual(null);}
 function toggleGPS(){setGpsWanted(v=>!v);}
 return <main className="appShell">
  <header className="topbar">
   <div><h1>ČASOVAČ<span className="dot">.</span></h1></div>
   <div className="headActions">
    <button className="headButton" type="button" onClick={()=>{setQuery(active?.[0]??'');setEditing(true);setError('');}} aria-label="Vybrat sledovaný spoj" title="Vybrat sledovaný spoj"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m15 5 4 4M4 20l4.8-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
    <button className={'headButton '+(gpsWanted&&!gpsError&&gpsAge!==null&&gpsAge<=20?'gpsActive':'')} onClick={toggleGPS} aria-pressed={gpsWanted} aria-label={gpsWanted?'Vypnout GPS':'Zapnout GPS'} title={gpsError||pos.status}>⌖ <span>GPS</span></button>
    <button className="headButton" onClick={()=>setSettings(true)} aria-label="Nastavení">⚙</button>
   </div>
  </header>

  {!active&&!editing&&<section className="panel searchPanel compactSearch"><button className="primary full" onClick={()=>setEditing(true)}>Vybrat sledovaný spoj</button></section>}
  {editing&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setEditing(false);}}>
   <section className="modal chooserModal" role="dialog" aria-modal="true" aria-label="Vybrat sledovaný spoj">
    <div className="row chooserHeading"><div><h2>Vybrat spoj</h2></div><button className="iconButton" onClick={()=>setEditing(false)} aria-label="Zavřít">✕</button></div>
    <input id="orderInput" autoFocus aria-label="Linka nebo linka/pořadí" placeholder="Např. 25 nebo 25/5" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&parseOrder(query))start();}}/>
    {!token.trim()?<p className="hint">Pro vyhledávání je potřeba API klíč Golemio v nastavení.</p>:
     !lookupLine?<p className="hint">Zadej číslo linky nebo konkrétní pořadí.</p>:
     <div className="chooserResults">
      <p className="chooserCaption">{!lookupReady&&!results.length?'Načítám dostupná pořadí…':lookupOrder?'Výsledek vyhledávání':'LINKA '+lookupLine+' · '+results.length+' POŘADÍ'}</p>
      {lookup.line===lookupLine&&lookup.error&&<p className="hint" role="status">{lookup.error}</p>}
      {lookupReady&&results.map(item=><button type="button" className="chooserRow" key={item.line+'/'+item.order} onClick={()=>start(item.line+'/'+item.order)}>
       <span className="chooserId"><span>{item.line}/</span><strong>{item.order}</strong></span><span className="chooserVehicle">#{item.car}</span><span className="chooserStop"><svg className="chooserStopIcon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="5" y="3" width="14" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M5 10h14M8 7h2m4 0h2M8 19l-2 3m10-3 2 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg><span>{chooserStop(item.target,stopNames)}</span></span>
      </button>)}
      {lookupReady&&!lookup.error&&lookupOrder&&results.length===0&&<div className="chooserMissing"><strong>Pořadí {lookupOrder[0]}/{lookupOrder[1]} není momentálně dostupné.</strong><p className="hint">Můžeš opravit zadání nebo pořadí sledovat a počkat na data.</p><button className="primary full" onClick={()=>start()}>Sledovat {lookupOrder[0]}/{lookupOrder[1]} a čekat na data</button></div>}
      {lookupReady&&!lookup.error&&!lookupOrder&&results.length===0&&<p className="hint">Aktuálně nejsou dostupná žádná pořadí. Konkrétní pořadí můžeš zadat ručně.</p>}
     </div>}
   </section>
  </div>}
  {error&&<div className="alert" role="status">{error}</div>}
  {active&&<section className="panel journeyPanel compactJourney">
    <div className="compactIdentity">
      <div className={'serviceBadge '+(active[0].length>=3?'serviceBadgeThree':'')} aria-label={'Linka '+active[0]+', pořadí '+active[1]}>
       <div className="routeTile">{active[0]}</div>
       <div className={'orderTile '+(active[1].length>=2?'orderTileTwo':'')}>{active[1]}</div>
      </div>
      <div className="identityDetails">
       <div className="routeDirection">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="identityIcon"><path d="M4 12h16m-7-7 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>{destination}</span>
       </div>
       <div className="vehicleNumber">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="identityIcon"><rect x="5" y="3.5" width="14" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.9"/><path d="M5 11h14M8 7.5h2m4 0h2M8 18.5l-2 3m10-3 2 3M9 21h6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>
        <span>#{chosen?vehicleId(chosen):lastSeen?.vehicle??'—'}</span>
       </div>
      </div>
      <button className={'vehicleStatus '+statusColor} type="button" onClick={()=>setDiagnostics(true)}
       aria-label={statusDescription+'; otevřít diagnostiku'} title={statusDescription}>
       <span className="statusDot"/>
      </button>
    </div>
    {highlightedStop&&displayedIndex!==null?
     <StopBoard stops={trip.stops} index={displayedIndex} tripId={tripId} remaining={highlightedRemaining}
      terminalWaiting={terminalWaiting} expanded={expanded} onExpand={()=>setExpanded(v=>!v)}
      onChoose={index=>setManual(index)} animate={manual===null&&!diagnostics}/>
     :<div className="compactEmpty">
       {loading||trip.loading?'Načítání…':chosen?trip.error||'Jízdní řád nedostupný':lastSeen?
       'Poslední vůz #'+lastSeen.vehicle+' · '+new Date(lastSeen.lastSeenAt).toLocaleTimeString('cs-CZ'):error?'Data jsou dočasně nedostupná':'Pořadí nenalezeno'}
      </div>}
  </section>}
  {!active&&<section className="panel emptyWelcome"><h2>Připraveno ke sledování</h2><p>Vyplň linku a pořadí. Časovač potom načte živé vozidlo a jízdní řád bez stahování GTFS souborů.</p></section>}

  <div className={diagnostics?'diagnosticVisible':'diagnosticHidden'}><div className="diagHeading"><h2>Diagnostika</h2><button onClick={()=>setDiagnostics(false)} className="quiet">Zavřít</button></div>
   <Diagnostics active={active} features={features} chosen={chosen??null} trip={trip} gps={gps} gpsError={gpsError} gpsWanted={gpsWanted} gpsAge={gpsAge} age={age} lastFetch={lastFetch} error={error} matchingCount={matches.length} position={position} positionState={pos.status} vehicleDistance={pos.vehicleDistance} manual={manual} setManual={setManual} selectedTrip={selectedTrip} setSelectedTrip={chooseTrip} startGps={()=>setGpsWanted(true)} stopGps={()=>setGpsWanted(false)} nextStopId={nextStopId} departure={departureDetection} remote={remote} onboard={compatible} onboardDecision={onboard} terminalWaiting={terminalWaiting} terminalName={terminalName} queryMode={queryMode} terminalCandidates={terminalCandidates} remoteProgress={remoteProgress} lastSeen={lastSeen} relatedVehicle={relatedVehicle} chainDiagnostic={chainDiagnostic} lastHandoff={lastHandoff} plannedHandoff={plannedHandoff?.next??null} handoffContinuity={continuity.reason} handoffDeparture={departureEvidence.reason} recorder={recorder}/>
  </div>

  <button className="debugFab" onClick={()=>setDiagnostics(v=>!v)} aria-label={diagnostics?'Zavřít diagnostiku':'Otevřít diagnostiku'} title="Diagnostika">{diagnostics?'×':'⌘'}</button>

  {settings&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false);}}>
   <div className="modal" role="dialog" aria-modal="true" aria-label="Nastavení">
    <div className="row"><h2>Nastavení</h2><button className="iconButton" onClick={()=>setSettings(false)} aria-label="Zavřít">✕</button></div>
    <label htmlFor="token">GOLEMIO API KLÍČ</label>
    <div className="search"><input id="token" type={tokenVisible?'text':'password'} value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="X-Access-Token"/><button onClick={()=>setTokenVisible(v=>!v)}>{tokenVisible?'Skrýt':'Ukázat'}</button></div>
    <label className="rememberOption"><input type="checkbox" checked={rememberToken} onChange={e=>setRememberToken(e.target.checked)}/><span>Zapamatovat klíč v tomto prohlížeči</span></label>
    <p className="hint">Při zapamatování se token uloží nešifrovaně v localStorage tohoto prohlížeče. Neukládá se na GitHub ani do URL; čtou ho však skripty stránky a může být dostupný rozšířením.</p>
    <button className="quiet full" disabled={!token} onClick={forget}>Zapomenout API klíč</button>
    <button className="primary full" onClick={()=>setSettings(false)}>Hotovo</button>
   </div>
  </div>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
