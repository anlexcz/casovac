import {useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Diagnostics from './Diagnostics';
import {useTripData,formatStopTime,countdownSeconds} from './tripData';
import {usePosition} from './position';
import {useDepartureDetection} from './departure';
import {useRecorder} from './recorder';
import {remoteEstimate} from './remoteTracking';
import type {RemoteHistory} from './remoteTracking';
import {distanceMeters} from './position';
import {useOnboardMode} from './onboard';
import {readLastSeen,saveLastSeen,extractRecordedVehicle} from './lastSeen';
import type {LastSeen} from './lastSeen';
import {observationTimestamp} from './remoteTracking';
import type {GpsFix} from './position';
import './style.css';

type Obj=Record<string,unknown>;
type Feature={properties?:Obj;geometry?:{coordinates?:unknown}};
const API='https://api.golemio.cz/v2/vehiclepositions';
const TOKEN_KEY='casovac:golemio-token:v1';
const ROUTE_KEY='casovac:last-order:v1';
const GPS_KEY='casovac:gps-preferred:v1';
const stored=(key:string):string=>{try{return localStorage.getItem(key)??'';}catch{return '';}};
const save=(key:string,value:string)=>{try{if(value)localStorage.setItem(key,value);else localStorage.removeItem(key);return true;}catch{return false;}};
const path=(obj:unknown,p:string):unknown=>p.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Obj)[k]:undefined,obj);
const text=(value:unknown):string=>value===undefined||value===null?'—':String(value);
const selectedTripId=(f:Feature)=>text(path(f,'properties.trip.gtfs.trip_id')??path(f,'properties.trip.trip_id'));
const vehicleId=(f:Feature)=>text(path(f,'properties.trip.vehicle_registration_number')??path(f,'properties.trip.vehicle.id')??path(f,'properties.trip.vehicle_id'));
const orderOf=(f:Feature)=>path(f,'properties.trip.sequence_id')??path(f,'properties.trip.cis.order')??path(f,'properties.trip.order')??path(f,'properties.trip.gtfs.run_number');
const normalize=(v:unknown)=>String(v??'').replace(/^0+/,'')||'0';
// Negative = before scheduled departure, zero and positive = at/after it.
const signedTime=(remaining:number|null)=>{
 if(remaining===null)return '—';
 const elapsed=-remaining;
 const magnitude=Math.abs(elapsed);
 return (elapsed<0?'−':'+')+String(Math.floor(magnitude/60)).padStart(2,'0')+':'+String(magnitude%60).padStart(2,'0');
};
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
 const [active,setActive]=useState<[string,string]|null>(null);
 const [diagnostics,setDiagnostics]=useState(false);
 const [selectedTrip,setSelectedTrip]=useState('');
 const [manual,setManual]=useState<number|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [editing,setEditing]=useState(false);
 const [features,setFeatures]=useState<Feature[]>([]);
 const [lastFetch,setLastFetch]=useState<number|null>(null);
 const [queryMode,setQueryMode]=useState('active');
 const [lastSeen,setLastSeen]=useState<LastSeen|null>(null);
 const [relatedVehicle,setRelatedVehicle]=useState<{vehicle:string;route:string;order:string;state:string;time:number}|null>(null);
 const previousScanRef=useRef(0);
 const [terminalCandidates,setTerminalCandidates]=useState<unknown[]>([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [now,setNow]=useState(Date.now());
 const [gpsWanted,setGpsWanted]=useState(()=>stored(GPS_KEY)==='1');
 const [gps,setGps]=useState<GpsFix|null>(null);
 const [gpsError,setGpsError]=useState('');
 const requestRef=useRef(0);
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
    const headers={'X-Access-Token':token.trim()};
    const response=await fetch(url,{headers,signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw Error('Golemio HTTP '+response.status);
    const data:unknown=await response.json();
    if(!data||typeof data!=='object'||!Array.isArray((data as Obj).features))throw Error('Neplatná odpověď živých poloh');
    if(alive&&generation===requestRef.current){
     const standard=(data as {features:Feature[]}).features;
     const filterOrder=(list:Feature[])=>list.filter(feature=>{
      const candidateLine=path(feature,'properties.trip.gtfs.route_short_name')??path(feature,'properties.trip.route_short_name');
      return normalize(orderOf(feature))===normalize(active![1])&&(candidateLine===undefined||String(candidateLine)===active![0]);
     });
     let fetched=standard;
     let matching=filterOrder(fetched);
     let queryMode='active';
     // Vehicles waiting on a terminal may not be actively tracking a trip.
     // Only query the wider set when the normal response lacks the order.
     if(!matching.length){
      try{
       const extended=new URL(url);
       extended.searchParams.set('includeNotTracking','true');
       const extra=await fetch(extended,{headers,signal:controller.signal,cache:'no-store'});
       if(extra.ok){
        const payload:unknown=await extra.json();
        if(payload&&typeof payload==='object'&&Array.isArray((payload as Obj).features)){
         fetched=(payload as {features:Feature[]}).features;
         matching=filterOrder(fetched);
         queryMode='includeNotTracking';
        }
       }
      }catch(e){if(controller.signal.aborted)throw e;}
     }
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
       const broader=await fetch(globalUrl,{headers,signal:controller.signal,cache:'no-store'});
       if(broader.ok){
        const body:unknown=await broader.json();
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
       }else queryMode='globalScanHTTP'+broader.status;
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
     const selected=matching.length===1?matching[0]:null;
     const candidates=!selected?fetched.map(feature=>({
       order:orderOf(feature),vehicle:vehicleId(feature),tripId:selectedTripId(feature),
       route:path(feature,'properties.trip.gtfs.route_short_name'),state:path(feature,'properties.last_position.state_position'),
       tracking:path(feature,'properties.last_position.tracking'),
       start:path(feature,'properties.trip.start_timestamp'),
       nextStop:path(feature,'properties.last_position.next_stop'),
       lastStop:path(feature,'properties.last_position.last_stop')
     })):null;
     recordApiRef.current({line:active![0],order:active![1],responseStatus:response.status,
      requestStartedAt,responseAt:Date.now(),matchingCount:matching.length,vehicle:selected,gps:gpsRef.current,
      source:selected?'unique_order':'ambiguous_or_missing',candidateVehicles:candidates,queryMode});
     if(selected){
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

 const matches=active?features.filter(f=>{
  const line=path(f,'properties.trip.gtfs.route_short_name')??path(f,'properties.trip.route_short_name');
  return normalize(orderOf(f))===normalize(active[1])&&(line===undefined||String(line)===active[0]);
 }):[];
 const chosen=selectedTrip?features.find(f=>selectedTripId(f)===selectedTrip)??null:matches.length===1?matches[0]:null;
 const tripId=chosen?selectedTripId(chosen):'';
 const trip=useTripData(tripId,token.trim());
 const age=lastFetch===null?null:Math.max(0,Math.floor((now-lastFetch)/1000));
 const gpsAge=gps?Math.max(0,Math.floor((now-gps.timestamp)/1000)):null;
 const coords=chosen?.geometry?.coordinates;
 const vehicleCoords:[number,number]|null=Array.isArray(coords)&&coords.length>=2&&Number.isFinite(Number(coords[0]))&&Number.isFinite(Number(coords[1]))?[Number(coords[0]),Number(coords[1])]:null;
 const nextStopId=text(path(chosen,'properties.last_position.next_stop.id')??path(chosen,'properties.last_position.next_stop'));
 const pos=usePosition(trip.stops,tripId,nextStopId,gps,vehicleCoords,age,now);
 const remote=remoteEstimate({feature:chosen??null,stops:trip.stops,raw:trip.raw,tripId,fetchedAt:lastFetch,now,history:historyRef.current.previous});
 const sourceAge=remote.sourceAge;
 const onboard=useOnboardMode({tripId,wanted:gpsWanted,gps,vehicle:vehicleCoords,raw:trip.raw,
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
 const terminalWaiting=!!chosen&&!!firstStop&&firstStopDistance!==null&&firstStopDistance<=150&&
  firstDeparture!==null&&firstDeparture>=0&&firstDeparture<=7200&&
  (queryMode==='includeNotTracking'||remote.vehicleState==='at_stop');
 const terminalName=terminalWaiting?firstStop?.name??null:null;
 const terminalCountdown=terminalWaiting?firstDeparture:null;
 const displayedIndex=terminalWaiting?0:position;
 const highlightedStop=displayedIndex!==null?trip.stops[displayedIndex]:undefined;
 const highlightedTime=terminalWaiting?(firstStop?.departure||firstStop?.arrival||''):departure;
 const highlightedRemaining=terminalWaiting?terminalCountdown:seconds;
 const clockState=highlightedRemaining===null?'clockUnknown':highlightedRemaining>0?'clockEarly':'clockReady';
 const futureStops=displayedIndex===null?[]:trip.stops.slice(displayedIndex+1);
 useEffect(()=>{
  const recordActive=recorder.session?.state==='recording'&&active&&
   recorder.session.target.line===active[0]&&recorder.session.target.order===active[1];
  if(!recordActive){lastDecisionRef.current='';return;}
  const summary={tripId,vehicle:chosen?vehicleId(chosen):null,queryMode,
   mode:onboard.mode,paired:compatible,gap:onboard.gap,routeGap:onboard.routeGap,
   reason:onboard.reason,remoteSource:remote.source,remoteState:remote.status,
   vehicleState:remote.vehicleState,lastStopSequence:remote.previousIndex===null?null:trip.stops[remote.previousIndex]?.sequence??null,
   nextStopSequence:remote.nextIndex===null?null:trip.stops[remote.nextIndex]?.sequence??null,
   currentIndex:position,stopName:current?.name??null,departurePhase:departureDetection.phase,
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
    remote.nextIndex,position,departureDetection.phase,departureDetection.lastSwitch,terminalWaiting]);
 function start(){
  const parsed=parseOrder(query);if(!parsed){setError('Zadej linku a pořadí, například 25/5.');return;}
  if(!token.trim()){setSettings(true);setError('Nejdřív vlož API klíč v Nastavení.');return;}
  setSelectedTrip('');setManual(null);setExpanded(false);setEditing(false);
  setFeatures([]);setLastFetch(null);setError('');
  setActive(parsed);
 }
 function forget(){
  setRememberToken(false);setToken('');save(TOKEN_KEY,'');setActive(null);setFeatures([]);setSelectedTrip('');setSettings(false);
 }
 function chooseTrip(id:string){setSelectedTrip(id);setManual(null);}
 function toggleGPS(){setGpsWanted(v=>!v);}
 const showStops=expanded?trip.stops.map((stop,index)=>({stop,index})):nearby;
 return <main className="appShell">
  <header className="topbar">
   <div><h1>ČASOVAČ<span className="dot">.</span></h1></div>
   <div className="headActions">
    <button className={'headButton '+(gpsWanted&&!gpsError&&gpsAge!==null&&gpsAge<=20?'gpsActive':'')} onClick={toggleGPS} aria-pressed={gpsWanted} aria-label={gpsWanted?'Vypnout GPS':'Zapnout GPS'} title={gpsError||pos.status}>⌖ <span>GPS</span></button>
    <button className="headButton" onClick={()=>setSettings(true)} aria-label="Nastavení">⚙</button>
   </div>
  </header>

  {(!active||editing)&&<section className="panel searchPanel compactSearch">
   <div className="search"><input id="orderInput" aria-label="Linka / pořadí" inputMode="text" placeholder="25/5" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')start();}}/><button className="primary" onClick={start}>Sledovat</button></div>
  </section>}
  {error&&<div className="alert" role="status">{error}</div>}
  {active&&<section className="panel journeyPanel compactJourney">
    <div className="compactIdentity">
      <div className="routeTile" aria-label={'Linka '+active[0]}>{active[0]}</div>
      <div className="orderTile" aria-label={'Pořadí '+active[1]}>{active[1]}</div>
      <div className="identityDetails">
       <div className="routeDirection">{destination}</div>
       <div className="vehicleNumber">#{chosen?vehicleId(chosen):lastSeen?.vehicle??'—'}</div>
      </div>
      <button type="button" className="editOrder" onClick={()=>setEditing(v=>!v)} aria-label={editing?'Skrýt zadání':'Změnit linku nebo pořadí'} title="Změnit linku/pořadí">✎</button>
    </div>
    {highlightedStop?
     <div className={'activeDeparture '+clockState}>
       <div className="activeStopName">{highlightedStop.name}</div>
       <div className="departureNumbers">
        <span className="liveOffset" aria-label="Rozdíl od plánovaného odjezdu">{signedTime(highlightedRemaining)}</span>
        <time className="scheduledTime" aria-label="Odjezd podle jízdního řádu">{formatStopTime(highlightedTime)}</time>
       </div>
     </div>
     :<div className="compactEmpty">
       {loading||trip.loading?'Načítání…':chosen?trip.error||'Jízdní řád nedostupný':lastSeen?
       'Poslední vůz #'+lastSeen.vehicle+' · '+new Date(lastSeen.lastSeenAt).toLocaleTimeString('cs-CZ'):'Pořadí nenalezeno'}
      </div>}
    {futureStops.length>0&&<div className="upcomingStops">
      {(expanded?futureStops:futureStops.slice(0,6)).map((stop,i)=>
       <button type="button" className="upcomingStop" key={stop.sequence+'-'+i} onClick={()=>setManual((displayedIndex??0)+i+1)} title="Vybrat zastávku">
        <span className="upcomingName">{stop.name}</span>
        <time className="upcomingTime">{formatStopTime(stop.departure||stop.arrival)}</time>
       </button>)}
      {futureStops.length>6&&<button type="button" className="moreStops" onClick={()=>setExpanded(v=>!v)}>{expanded?'Méně':'Další zastávky ('+(futureStops.length-6)+')'}</button>}
    </div>}
  </section>}
  {!active&&<section className="panel emptyWelcome"><h2>Připraveno ke sledování</h2><p>Vyplň linku a pořadí. Časovač potom načte živé vozidlo a jízdní řád bez stahování GTFS souborů.</p></section>}

  <div className={diagnostics?'diagnosticVisible':'diagnosticHidden'}><div className="diagHeading"><h2>Diagnostika</h2><button onClick={()=>setDiagnostics(false)} className="quiet">Zavřít</button></div>
   <Diagnostics active={active} features={features} chosen={chosen??null} trip={trip} gps={gps} gpsError={gpsError} gpsWanted={gpsWanted} gpsAge={gpsAge} age={age} lastFetch={lastFetch} error={error} matchingCount={matches.length} position={position} positionState={pos.status} vehicleDistance={pos.vehicleDistance} manual={manual} setManual={setManual} selectedTrip={selectedTrip} setSelectedTrip={chooseTrip} startGps={()=>setGpsWanted(true)} stopGps={()=>setGpsWanted(false)} nextStopId={nextStopId} departure={departureDetection} remote={remote} onboard={compatible} onboardDecision={onboard} terminalWaiting={terminalWaiting} terminalName={terminalName} queryMode={queryMode} terminalCandidates={terminalCandidates} lastSeen={lastSeen} relatedVehicle={relatedVehicle} recorder={recorder}/>
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
