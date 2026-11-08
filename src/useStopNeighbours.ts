import {useEffect,useMemo,useState} from 'react';
import type {Feature} from './featureUtils.ts';
import {path,selectedTripId,routeOf} from './featureUtils.ts';
import type {Stop} from './tripData.ts';
import {parseStops} from './tripData.ts';
import {resolveNeighbourStops} from './neighbourStatic.ts';
import {safeStaticServiceDate} from './staticTripAdapter.ts';
import {golemioJson} from './golemioClient.ts';
import {NEIGHBOUR_POLL_MS,NEIGHBOUR_RETAIN_MS,UPCOMING_STOP_COUNT} from './pollingCadence.ts';
import type {NeighbourSettings} from './stopNeighbours.ts';
import {departureBoardUrl,parseNeighbourBoard} from './stopNeighbourBoard.ts';
import {staticNeighbourBoard} from './staticNeighbourBoard.ts';
import {pidStatic} from './pidStatic.ts';
import {findBoardContinuations} from './boardBlockContinuity.ts';
import type {BoardContinuation} from './boardBlockContinuity.ts';
import type {DepartureBoard} from './stopNeighbourBoard.ts';
import {departureBoardNameUrl,resolveOwnPlatform} from './resolveNeighbourPlatform.ts';
import {recordNeighbourDiagnostic,summarizeNeighbourBoardResponse,summarizeNeighbourBoardCounts,summarizeTripStopSchema} from './neighbourDiagnostics.ts';

type BoardState={key:string;board:DepartureBoard|null;at:number;error:string;loading:boolean};
type FeatureState={key:string;features:Feature[];complete:boolean;failed:boolean};
type DetailState={key:string;stops:Map<string,Stop[]>;complete:boolean};
const EMPTY:BoardState={key:'',board:null,at:0,error:'',loading:false};
const boardCache=new Map<string,{board:DepartureBoard;at:number}>();
const tripCache=new Map<string,Stop[]>();
const platformCache=new Map<string,{id:string;platformCode:string;at:number}>();
const vehicleCache=new Map<string,{features:Feature[];at:number}>();
const continuationCache=new Map<string,Map<string,BoardContinuation>>();
const PLATFORM_TTL=15*60000;
// Keep the last successful snapshot across three 60-second poll attempts.
// Freshness for *new queries* remains 60 s; retention is NOT LIVE validity.
const VEHICLE_TTL=NEIGHBOUR_POLL_MS;
const VEHICLE_RETAIN_MS=NEIGHBOUR_RETAIN_MS;
const BOARD_TTL=NEIGHBOUR_POLL_MS;
const BOARD_RETAIN_MS=NEIGHBOUR_RETAIN_MS;
const gtfsSeconds=(time:string)=>{const m=/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(time);
 return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0):null;};
const dateLocal=(now:number)=>new Intl.DateTimeFormat('sv-SE',{
 timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(now));
async function tripStops(
 tripId:string,date:string,token:string,boardStopId:string,routeShortName:string
):Promise<Stop[]>{
 // Cache is scoped to the exact BOARD platform and line as well as trip/day:
 // a fallback schedule must never be reused for a different boarding edge.
 const key=[date,tripId,boardStopId,routeShortName].join('|');
 const existing=tripCache.get(key);
 if(existing)return existing;
 const started=Date.now();
 const result=await resolveNeighbourStops({
  tripId,date,boardStopId,routeShortName,
  staticAllowed:!!safeStaticServiceDate(date,true,new Date()),
  fallback:async()=>{
   if(!token)throw Error('Statický detail PID není dostupný a Golemio klíč chybí.');
   const url=new URL('https://api.golemio.cz/v2/gtfs/trips/'+encodeURIComponent(tripId));
   url.searchParams.set('date',date);
   url.searchParams.set('includeStops','true');
   url.searchParams.set('includeStopTimes','true');
   const raw=await golemioJson<unknown>(url.toString(),token,6*3600000,'low');
   return parseStops(raw);
  }
 });
 const stops=result.stops;
 recordNeighbourDiagnostic({
  at:Date.now(),kind:'warmup',stopId:boardStopId,stopName:'',
  tripId,endpoint:result.source==='PID GTFS'?'PID Static Engine':'/v2/gtfs/trips/{id}',
  elapsedMs:Date.now()-started,
  counts:{tripStops:stops.length,staticSource:result.source==='PID GTFS'?1:0,
   onlineFallback:result.source==='Golemio'?1:0},
  note:result.source==='PID GTFS'?
   'Statický detail okolního tripu ověřen podle dne, linky a nástupní hrany.':
   'Statický detail není dostupný či nesouhlasí, použit původní online detail.'
 });
 if(stops.length){
  tripCache.set(key,stops);
  if(tripCache.size>240)tripCache.delete(tripCache.keys().next().value!);
 }
 return stops;
}
function collectFeatures(raw:unknown):Feature[]{
 const arr=path(raw,'features');
 return Array.isArray(arr)?arr as Feature[]:[];
}
const boardId=(date:string,stopId:string)=>date+'|'+stopId;
export function useStopNeighbours(args:{
 enabled:boolean;token:string;now:number;ownFeature:Feature|null;rawTrip?:unknown;
 ownTripId:string;stops:Stop[];currentIndex:number|null;staticDate?:string;
 requestedIndex:number|null;settings:NeighbourSettings;knownFeatures:Feature[];
}){
 const {enabled,token,now,ownFeature,ownTripId,stops,currentIndex,requestedIndex,settings,knownFeatures,staticDate}=args;
 const index=requestedIndex??currentIndex;
 const stop=index===null?null:stops[index]??null;
 const date=staticDate||dateLocal(now);
 const unresolvedKey=date+'|'+ownTripId+'|'+String(index??-1)+'|'+(stop?.name??'')+'|'+(stop?.arrival||stop?.departure||'');
 const [resolved,setResolved]=useState<{key:string;id:string;platformCode:string;error:string}>({key:'',id:'',platformCode:'',error:''});
 const prefetchedPlatform=platformCache.get(unresolvedKey);
 const rememberedPlatform=prefetchedPlatform&&Date.now()-prefetchedPlatform.at<PLATFORM_TTL?prefetchedPlatform:null;
 const selectedStopId=stop?.id||(resolved.key===unresolvedKey?resolved.id:rememberedPlatform?.id??'');
 const selectedPlatformCode=stop?.platformCode||(resolved.key===unresolvedKey?resolved.platformCode:rememberedPlatform?.platformCode??'');
 const effectiveStop=useMemo(()=>stop&&selectedStopId?{...stop,id:selectedStopId}:stop,[stop,selectedStopId]);
 const key=date+'|'+ownTripId+'|'+String(index??-1)+'|'+selectedStopId+'|'+(stop?.arrival||stop?.departure||'');
 const gate={
  enabled,hasToken:!!token,hasVehicle:!!ownFeature,hasTrip:!!ownTripId&&ownTripId!=='—',
  hasPlatform:!!selectedStopId,selectedStopId,selectedPlatformCode,stopName:stop?.name??'',
  ownTripId,index,stopsCount:stops.length
 };
 // The public trip detail currently supplies 37 stop-time features with
 // geometry, name, sequence and times but no stop_id. Recover it via the
 // operator's departure board, accepting ONLY the exact own trip and time.
 useEffect(()=>{
  if(!enabled||!token||!stop?.name||!!stop.id||!!rememberedPlatform||!ownTripId||ownTripId==='—')return;
  let active=true;
  const started=Date.now();
  const context={stopId:'',stopName:stop.name,tripId:ownTripId,
   endpoint:'/v2/pid/departureboards · names (platform discovery)'};
  recordNeighbourDiagnostic({...context,at:started,kind:'request',
   note:'Ověřuji nástupní hranu podle trip ID a času JŘ; čas='+
    (stop.arrival||stop.departure)+' (služební den '+date+')'});
  void golemioJson<DepartureBoard>(departureBoardNameUrl(stop.name,stop.arrival||stop.departure,date),token,12000,'high')
   .then(board=>{
    const at=Date.now();
    const resolution=resolveOwnPlatform(board,ownTripId,stop.arrival||stop.departure);
    recordNeighbourDiagnostic({...context,at,kind:'response',
     elapsedMs:at-started,shape:summarizeNeighbourBoardResponse(board),
     counts:{...summarizeNeighbourBoardCounts(board,''),ownTripMatches:resolution.matches,
      resolvedPlatform:resolution.id?1:0},
     note:resolution.reason+(resolution.id?' · '+resolution.id:'')});
    if(resolution.id)platformCache.set(unresolvedKey,{id:resolution.id,platformCode:resolution.platformCode,at});
    if(active)setResolved({key:unresolvedKey,id:resolution.id,platformCode:resolution.platformCode,error:resolution.reason});
   }).catch(e=>{
    const message=e instanceof Error?e.message:String(e);
    recordNeighbourDiagnostic({...context,at:Date.now(),kind:'error',
     elapsedMs:Date.now()-started,note:'Vyhledání stop_id: '+message.slice(0,280)});
    if(active)setResolved({key:unresolvedKey,id:'',platformCode:'',error:message});
   });
  return()=>{active=false;};
 },[enabled,token,unresolvedKey,stop?.name,stop?.id,stop?.arrival,stop?.departure,ownTripId,!!rememberedPlatform]);
 // The public GTFS trip contains names but often no platform IDs. A
 // short, sequential, low-priority warmup resolves only the next THREE stop
 // occurrences before the tram reaches them. No speculative full-day scan.
 useEffect(()=>{
  if(!enabled||!token||!ownFeature||!ownTripId||ownTripId==='—'||
   currentIndex===null||!stops.length)return;
  let active=true;
  const upcoming=stops.slice(currentIndex+1,currentIndex+1+UPCOMING_STOP_COUNT)
   .map((candidate,offset)=>({candidate,index:currentIndex+1+offset}))
   .filter(({candidate})=>!!candidate.name&&!candidate.id);
  const timer=window.setTimeout(()=>{
   void (async()=>{
    for(const {candidate,index:futureIndex} of upcoming){
     if(!active)return;
     const futureKey=date+'|'+ownTripId+'|'+futureIndex+'|'+candidate.name+'|'+
      (candidate.arrival||candidate.departure||'');
     const cached=platformCache.get(futureKey);
     if(cached&&Date.now()-cached.at<PLATFORM_TTL)continue;
     try{
      const body=await golemioJson<DepartureBoard>(
       departureBoardNameUrl(candidate.name,candidate.arrival||candidate.departure,date),
       token,60000,'low');
      const resolved=resolveOwnPlatform(body,ownTripId,candidate.arrival||candidate.departure);
      if(resolved.id){
       const at=Date.now();
       platformCache.set(futureKey,{
        id:resolved.id,platformCode:resolved.platformCode,at
       });
       // Name-based discovery is anchored to our OWN scheduled visit, so it
       // already contains a consistent set of nearby trips. Preserve that
       // exact boarding-edge subset for immediate first paint upon arrival.
       // The normal high-priority board poll will still update live delays.
       const departures=(body.departures??[]).filter(d=>d.stop?.id===resolved.id);
       if(departures.length){
        const cacheKey=boardId(date,resolved.id);
        const previous=boardCache.get(cacheKey);
        if(!previous||previous.at<at)
         boardCache.set(cacheKey,{board:{departures},at});
       }
      }
     }catch{/* Optional warmup must not block the selected stop. */}
    }
   })();
  },1500);
  return()=>{active=false;window.clearTimeout(timer);};
 },[enabled,token,ownTripId,date,currentIndex,stops,!!ownFeature]);
 // A stop advance starts a new 60-second refresh cycle. A further advance
 // within that minute restarts it; do not align requests to wall-clock minutes.
 const [refreshCycle,setRefreshCycle]=useState(0);
 useEffect(()=>{
  if(!enabled||currentIndex===null||!ownTripId||ownTripId==='—')return;
  setRefreshCycle(v=>v+1);
  const timer=window.setInterval(()=>setRefreshCycle(v=>v+1),NEIGHBOUR_POLL_MS);
  return()=>window.clearInterval(timer);
 },[enabled,currentIndex,ownTripId,date]);
 const [boardState,setBoardState]=useState<BoardState>(EMPTY);
 const [live,setLive]=useState<FeatureState>({key:'',features:[],complete:false,failed:false});
 const [detail,setDetail]=useState<DetailState>({key:'',stops:new Map(),complete:false});
 const cached=boardCache.get(boardId(date,selectedStopId));
 const readyBoard=boardState.key===key&&boardState.board?boardState.board:
  cached&&Date.now()-cached.at<BOARD_RETAIN_MS?cached.board:null;
 const [transition,setTransition]=useState<{key:string;data:Map<string,BoardContinuation>;ready:boolean}>(
  {key:'',data:new Map(),ready:false});
 const transitionKey=[pidStatic.getDataStatus().version,date,selectedStopId,
  stop?.arrival||stop?.departure||''].join('|');
 useEffect(()=>{
  if(!enabled||!readyBoard||!selectedStopId){
   setTransition({key:transitionKey,data:new Map(),ready:false});return;
  }
  const cached=continuationCache.get(transitionKey);
  if(cached){setTransition({key:transitionKey,data:cached,ready:true});return;}
  let alive=true;
  const time=gtfsSeconds(stop?.arrival||stop?.departure||'');
  if(time===null){setTransition({key:transitionKey,data:new Map(),ready:true});return;}
  void findBoardContinuations(readyBoard,date,time).then(data=>{
   if(!alive)return;
   continuationCache.set(transitionKey,data);
   if(continuationCache.size>80)continuationCache.delete(continuationCache.keys().next().value!);
   setTransition({key:transitionKey,data,ready:true});
  }).catch(()=>{
   if(alive)setTransition({key:transitionKey,data:new Map(),ready:true});
  });
  return()=>{alive=false;};
 },[enabled,readyBoard,selectedStopId,transitionKey,date]);
 // Static PID departures now cover all verified GTFS IDs of one physical edge.
 // Golemio fallback remains scoped to the exact ID on source failure.
 useEffect(()=>{
  if(!enabled||!selectedStopId||!ownTripId||ownTripId==='—'){
   const reasons=[
    !enabled?'Okolní spoje jsou vypnuté v nastavení':'',
    !token?'Není zadaný API klíč':'',
    !selectedStopId?(resolved.key===unresolvedKey&&resolved.error?'Identifikace nástupní hrany: '+resolved.error:'Čekám na ověření GTFS stop_id z odjezdníku'):'',
    !ownFeature?'Není identifikovaný živý trip sledované tramvaje':''
   ].filter(Boolean);
   recordNeighbourDiagnostic({
    at:Date.now(),kind:'blocked',stopId:selectedStopId,stopName:stop?.name??'',
    tripId:ownTripId,endpoint:'/v2/pid/departureboards',
    note:reasons.join('; '),
    shape:!selectedStopId&&!!args.rawTrip?summarizeTripStopSchema(args.rawTrip):undefined,
    counts:!selectedStopId&&stops.length?{tripStops:stops.length,missingPlatformIds:stops.filter(x=>!x.id).length}:undefined
   });
   setBoardState(EMPTY);return;
  }
  let valid=true;
  const old=boardCache.get(boardId(date,selectedStopId));
  const started=Date.now();
  const context={stopId:selectedStopId,stopName:stop?.name??'',tripId:ownTripId,
   endpoint:'PID GTFS getDepartures / Golemio fallback'};
  recordNeighbourDiagnostic({
   ...context,at:started,kind:'request',
   note:'PID GTFS first: verified physical platform '+selectedStopId+'; -45/+20 min; Golemio fallback only with token'+
    (old?' · cached board '+Math.round((started-old.at)/1000)+' s old':' · no local cache')
  });
  setBoardState(previous=>({
   key,board:previous.key===key?previous.board:old?.board??null,
   at:previous.key===key?previous.at:old?.at??0,
   error:'',loading:true
  }));
  const ownSeconds=gtfsSeconds(stop?.arrival||stop?.departure||'');
  const fallback=()=>token?
   golemioJson<DepartureBoard>(departureBoardUrl([selectedStopId]),token,60000,'high'):
   Promise.reject(Error('Bez statického PID GTFS nelze načíst odjezdy bez API klíče.'));
  const source=ownSeconds===null?fallback():
   staticNeighbourBoard(selectedStopId,date,ownSeconds).catch(fallback);
  void source.then(body=>{
   const at=Date.now();
   recordNeighbourDiagnostic({
    ...context,at,kind:'response',elapsedMs:at-started,
    note:valid?'Decoded response':'Response arrived after effect cleanup; ignored by UI',
    shape:summarizeNeighbourBoardResponse(body),
    counts:summarizeNeighbourBoardCounts(body,selectedStopId)
   });
   if(!valid){
    recordNeighbourDiagnostic({...context,at,kind:'discarded',
     note:'A pending request completed after the minute poll invalidated this effect.'});
    return;
   }
   if(!Array.isArray(body?.departures))throw Error('Zdroj odjezdů nevrátil očekávané pole departures.');
   boardCache.set(boardId(date,selectedStopId),{board:body,at});
   if(boardCache.size>70)boardCache.delete(boardCache.keys().next().value!);
   setBoardState({key,board:body,at,error:'',loading:false});
  }).catch(e=>{
   const at=Date.now();
   const message=e instanceof Error?e.message:String(e);
   const status=/HTTP\\s+(\\d{3})/i.exec(message);
   recordNeighbourDiagnostic({
    ...context,at,kind:'error',elapsedMs:at-started,
    httpStatus:status?Number(status[1]):null,
    note:message.slice(0,350)+(valid?'':' (effect no longer active)')
   });
   if(valid)setBoardState(prev=>({...prev,key,loading:false,error:message}));
  });
  return()=>{valid=false;};
 },[enabled,token,key,selectedStopId,date,refreshCycle,resolved.key,resolved.error]);

 // Static departures and a bounded shared LIVE snapshot for four future stops.
 // A preview two stops ahead must open from warm data, not a new batch.
 useEffect(()=>{
  if(!enabled||!token||currentIndex===null||!stops.length)return;
  let alive=true;
  const upcoming=stops.slice(currentIndex,currentIndex+1+UPCOMING_STOP_COUNT).filter(s=>!!s.id);
  const timer=window.setTimeout(()=>{
   void (async()=>{
    const boards=await Promise.all(upcoming.map(async item=>{
     const cacheKey=boardId(date,item.id);
     const cachedBoard=boardCache.get(cacheKey);
     if(cachedBoard&&Date.now()-cachedBoard.at<BOARD_TTL)return cachedBoard.board;
     const secs=gtfsSeconds(item.arrival||item.departure||'');
     if(secs===null)return null;
     try{
      const board=await staticNeighbourBoard(item.id,date,secs);
      if(alive)boardCache.set(cacheKey,{board,at:Date.now()});
      return board;
     }catch{return null;}
    }));
    if(!alive)return;
    const lines=[...new Set(boards.flatMap(board=>(board?.departures??[])
     .filter(d=>[0,3,11].includes(d.route?.type??-1)).map(d=>d.route?.short_name??'').filter(Boolean)))];
    const ownLine=ownFeature?routeOf(ownFeature):'';
    // Bounded and cache-aware: avoid probing the whole fleet or every GTFS trip.
    const needed=lines.filter(line=>line!==ownLine&&
     (!vehicleCache.has(line)||Date.now()-vehicleCache.get(line)!.at>=VEHICLE_TTL)).slice(0,8);
    for(let i=0;i<needed.length&&alive;i+=3){
     const batch=needed.slice(i,i+3);
     await Promise.all(batch.map(async line=>{
      try{
       const url=new URL('https://api.golemio.cz/v2/vehiclepositions');
       url.searchParams.set('routeShortName',line);
       url.searchParams.set('limit','1000');
       const response=await golemioJson<unknown>(url.toString(),token,60000,'low');
       if(alive)vehicleCache.set(line,{features:collectFeatures(response),at:Date.now()});
      }catch{/* Optional ahead-of-time LIVE does not block the timer. */}
     }));
    }
   })();
  },350);
  return()=>{alive=false;window.clearTimeout(timer);};
 // A fresh minute updates the bounded LIVE subset; static boards stay cached.
 },[enabled,token,ownTripId,date,currentIndex,stops,refreshCycle,ownFeature?routeOf(ownFeature):'']);

 // Build ONE enrichment snapshot per platform/refresh rather than
 // progressively re-rendering after every route's individual API response.
 // Known live positions are used immediately; cached lines avoid re-querying.
 const routes=useMemo(()=>{
  if(!readyBoard||!selectedStopId)return [];
  const physical=new Set(readyBoard.physicalStopIds?.includes(selectedStopId)?readyBoard.physicalStopIds:[selectedStopId]);
  return [...new Set((readyBoard.departures??[]).filter(d=>
   !!d.stop?.id&&physical.has(d.stop.id)&&[0,3,11].includes(d.route?.type??-1))
   .map(d=>d.route?.short_name??'').filter(Boolean))].slice(0,10);
 },[readyBoard,selectedStopId]);
 const routeKey=routes.join('|');
 const physicalReadyIds=new Set(readyBoard?.physicalStopIds?.includes(selectedStopId)?readyBoard.physicalStopIds:[selectedStopId]);
 const allRouteCount=new Set((readyBoard?.departures??[]).filter(d=>
  !!d.stop?.id&&physicalReadyIds.has(d.stop.id)&&[0,3,11].includes(d.route?.type??-1))
  .map(d=>d.route?.short_name??'').filter(Boolean)).size;
 const liveIncomplete=!token||allRouteCount>routes.length||(live.key===key&&live.failed);
 useEffect(()=>{
  if(!enabled||!readyBoard)return;
  if(!token){setLive({key,features:[],complete:true,failed:true});return;}
  if(!routes.length){setLive({key,features:knownFeatures,complete:true,failed:false});return;}
  let active=true;
  const ownLine=ownFeature?routeOf(ownFeature):'';
  const initial=new Map(knownFeatures.map(f=>[selectedTripId(f),f]));
  const toFetch:string[]=[];
  for(const line of routes){
   if(line===ownLine)continue;
   const cache=vehicleCache.get(line);
   if(cache&&Date.now()-cache.at<VEHICLE_RETAIN_MS){
    for(const feature of cache.features){
     const id=selectedTripId(feature);
     if(id&&id!=='—')initial.set(id,feature);
    }
   }
   if(!cache||Date.now()-cache.at>=VEHICLE_TTL)toFetch.push(line);
  }
  // Preserve a completed snapshot while a replacement is pending; old
  // observations are individually rejected as LIVE by origin_timestamp.
  setLive(old=>({key,features:[...initial.values()],
   complete:!toFetch.length||(old.key===key&&old.complete),failed:false}));
  if(!toFetch.length)return;
  // Requests are bounded to three concurrent routes and published as a
  // single complete snapshot. Late individual responses only warm the
  // cache, never reshuffle the visible list part-way through the batch.
  void (async()=>{
   let failed=false;
   for(let start=0;start<toFetch.length;start+=3){
    const batch=toFetch.slice(start,start+3);
    const values=await Promise.all(batch.map(async line=>{
     const started=Date.now();
     const context={stopId:selectedStopId,stopName:stop?.name??'',
      tripId:ownTripId,endpoint:'/v2/vehiclepositions · routeShortName='+line};
     try{
      const url=new URL('https://api.golemio.cz/v2/vehiclepositions');
      url.searchParams.set('routeShortName',line);
      url.searchParams.set('limit','1000');
      const response=await golemioJson<unknown>(url.toString(),token,60000,'low');
      const fetched=collectFeatures(response);
      // HTTP 200 with no matching vehicles does not prove previously seen
      // vehicles ceased to exist; keep their last observation for 3 cycles.
      const previous=vehicleCache.get(line);
      const remembered=previous&&Date.now()-previous.at<VEHICLE_RETAIN_MS?
       previous.features.filter(f=>!fetched.some(n=>selectedTripId(n)===selectedTripId(f))):[];
      vehicleCache.set(line,{features:[...fetched,...remembered],at:Date.now()});
      recordNeighbourDiagnostic({...context,kind:'vehicle',at:Date.now(),
       elapsedMs:Date.now()-started,counts:{positions:fetched.length},
       note:'Vehiclepositions prepared as one coordinated batch'});
      return vehicleCache.get(line)?.features??fetched;
     }catch(e){
      failed=true;
      recordNeighbourDiagnostic({...context,kind:'error',at:Date.now(),
       elapsedMs:Date.now()-started,note:'Vehicle enrichment: '+
        (e instanceof Error?e.message:String(e)).slice(0,300)});
      return [] as Feature[];
     }
    }));
    for(const group of values)for(const feature of group){
     const id=selectedTripId(feature);
     if(id&&id!=='—')initial.set(id,feature);
    }
   }
   if(active)setLive({key,features:[...initial.values()],complete:true,failed});
  })();
  return()=>{active=false;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,token,key,routeKey,refreshCycle]);

 // Do not publish partial route enrichment: calculate from one completed
 // snapshot and prepare exact-trip geometry for both nearby scheduled rows
 // and delayed LIVE candidates.
 useEffect(()=>{
  if(!enabled||!readyBoard||!effectiveStop||index===null||
   live.key!==key||!live.complete)return;
  let alive=true;
  const ownSeconds=gtfsSeconds(effectiveStop.arrival||effectiveStop.departure||'')??0;
  const liveIds=new Set(live.features.map(selectedTripId));
  const physical=new Set(readyBoard.physicalStopIds?.includes(selectedStopId)?readyBoard.physicalStopIds:[selectedStopId]);
  const departures=[...(readyBoard.departures??[])].filter(d=>
   !!d.stop?.id&&physical.has(d.stop.id)&&[0,3,11].includes(d.route?.type??-1)&&
   !!d.trip?.id&&d.trip?.id!==ownTripId);
  const byDistance=(a:typeof departures[number],b:typeof departures[number])=>
   Math.abs((a.scheduledSeconds??ownSeconds)-ownSeconds)-
   Math.abs((b.scheduledSeconds??ownSeconds)-ownSeconds);
  const scheduled=departures.filter(d=>
   Math.abs((d.scheduledSeconds??ownSeconds)-ownSeconds)<=300).sort(byDistance);
  const observed=departures.filter(d=>liveIds.has(d.trip?.id??'')).sort(byDistance);
  const candidateRows=[...new Map([...observed,...scheduled]
   .map(d=>[d.trip!.id!,d])).values()].slice(0,40);
  const candidates=candidateRows.map(d=>({id:d.trip!.id!,line:d.route!.short_name!,stopId:d.stop!.id!}));
  // Do not blank an already rendered board for routine enrichment updates.
  setDetail(old=>({key,stops:old.key===key?old.stops:new Map(),
   complete:old.key===key&&old.complete}));
  void (async()=>{
   const found=new Map<string,Stop[]>();
   for(let start=0;start<candidates.length;start+=4){
    const batch=candidates.slice(start,start+4);
    const values=await Promise.all(batch.map(candidate=>
     tripStops(candidate.id,date,token,candidate.stopId,candidate.line).catch(()=>[])));
    if(!alive)return;
    batch.forEach((candidate,i)=>{if(values[i].length)found.set(candidate.id,values[i]);});
   }
   if(alive)setDetail(old=>({key,stops:new Map([
    ...(old.key===key?[...old.stops]:[]),...found]),complete:true}));
  })();
  return()=>{alive=false;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,token,key,readyBoard,date,live.key,live.complete,live.features]);

 const ownDelayRaw=path(ownFeature,'properties.last_position.delay.actual');
 const ownObserved=path(ownFeature,'properties.last_position.origin_timestamp');
 const ownStamp=typeof ownObserved==='string'?Date.parse(ownObserved):NaN;
 const ownDelay=typeof ownDelayRaw==='number'&&Number.isFinite(ownDelayRaw)&&
  Number.isFinite(ownStamp)&&now-ownStamp<=90000&&now-ownStamp>=-10000?
  ownDelayRaw:null;
 const complete=!!readyBoard&&live.key===key&&live.complete&&
  detail.key===key&&detail.complete&&transition.key===transitionKey&&transition.ready;
 const result=useMemo(()=>{
  if(!enabled||!effectiveStop||!selectedStopId||index===null||!readyBoard||!complete)return null;
  return parseNeighbourBoard({
   board:readyBoard,stop:effectiveStop,ownTripId,ownStops:stops,ownIndex:index,ownDelay,
   settings,distance:currentIndex===null?0:Math.max(0,index-currentIndex),
   features:live.key===key?[...knownFeatures,...live.features]:knownFeatures,
   candidateStops:detail.key===key?detail.stops:undefined,
   continuations:transition.key===transitionKey?transition.data:undefined,now
  });
 },[enabled,effectiveStop,index,selectedStopId,readyBoard,ownTripId,stops,ownDelay,settings,currentIndex,
  live,knownFeatures,detail,transition,transitionKey,key,now,complete]);
 useEffect(()=>{
  if(!result||!readyBoard||!selectedStopId)return;
  recordNeighbourDiagnostic({
   at:Date.now(),kind:'filter',stopId:selectedStopId,
   stopName:stop?.name??'',tripId:ownTripId,
   endpoint:'parseNeighbourBoard',
   counts:{...summarizeNeighbourBoardCounts(readyBoard,selectedStopId),
    displayed:result.rows.length,
    withVehicle:result.rows.filter(row=>!!row.vehicle).length,
    withOrder:result.rows.filter(row=>row.order!=='?').length},
   note:'Panel result after verified physical-platform, road-mode, service-time and ETA filtering'
  });
 // Logs only when board or enrichment changes, not every display countdown tick.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,readyBoard,live,detail]);
 async function probeDepartureBoard(){
  const context={stopId:selectedStopId,stopName:stop?.name??'',tripId:ownTripId,
   endpoint:'/v2/pid/departureboards · MANUAL TEST'};
  const nowAt=Date.now();
  if(!token||!selectedStopId){
   recordNeighbourDiagnostic({...context,at:nowAt,kind:'blocked',
    note:!token?'Diagnostický test: chybí API klíč':'Diagnostický test: chybí GTFS stop_id'});
   return;
  }
  recordNeighbourDiagnostic({...context,at:nowAt,kind:'request',
   note:'Ruční test bez ohledu na automatické zapnutí. ids[]='+selectedStopId});
  try{
   const body=await golemioJson<DepartureBoard>(
    departureBoardUrl([selectedStopId]),token,0,'high');
   recordNeighbourDiagnostic({...context,at:Date.now(),kind:'response',
    elapsedMs:Date.now()-nowAt,
    shape:summarizeNeighbourBoardResponse(body),
    counts:summarizeNeighbourBoardCounts(body,selectedStopId),
    note:'Ruční diagnostický test dokončen'});
  }catch(e){
   const message=e instanceof Error?e.message:String(e);
   const status=/HTTP\\s+(\\d{3})/i.exec(message);
   recordNeighbourDiagnostic({...context,at:Date.now(),kind:'error',
    elapsedMs:Date.now()-nowAt,httpStatus:status?Number(status[1]):null,
    note:'Ruční diagnostický test: '+message.slice(0,350)});
  }
 }
 const activeState=boardState.key===key?boardState:null;
 return {result,gate,probeDepartureBoard,complete,liveIncomplete,
  loading:!!activeState?.loading&&!readyBoard||!!readyBoard&&!complete,
  error:activeState?.error||(liveIncomplete?'Část živých poloh není dostupná.':''),
  updatedAt:activeState?.at??cached?.at??0};
}
