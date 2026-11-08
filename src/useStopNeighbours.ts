import {useEffect,useMemo,useState} from 'react';
import type {Feature} from './featureUtils.ts';
import {path,selectedTripId,routeOf} from './featureUtils.ts';
import type {Stop} from './tripData.ts';
import {parseStops} from './tripData.ts';
import {resolveNeighbourStops} from './neighbourStatic.ts';
import {safeStaticServiceDate} from './staticTripAdapter.ts';
import {golemioJson} from './golemioClient.ts';
import type {NeighbourSettings} from './stopNeighbours.ts';
import {departureBoardUrl,parseNeighbourBoard} from './stopNeighbourBoard.ts';
import {staticNeighbourBoard} from './staticNeighbourBoard.ts';
import type {DepartureBoard} from './stopNeighbourBoard.ts';
import {departureBoardNameUrl,resolveOwnPlatform} from './resolveNeighbourPlatform.ts';
import {recordNeighbourDiagnostic,summarizeNeighbourBoardResponse,summarizeNeighbourBoardCounts,summarizeTripStopSchema} from './neighbourDiagnostics.ts';

type BoardState={key:string;board:DepartureBoard|null;at:number;error:string;loading:boolean};
type FeatureState={key:string;features:Feature[]};
type DetailState={key:string;stops:Map<string,Stop[]>};
const EMPTY:BoardState={key:'',board:null,at:0,error:'',loading:false};
const boardCache=new Map<string,{board:DepartureBoard;at:number}>();
const tripCache=new Map<string,Stop[]>();
const platformCache=new Map<string,{id:string;platformCode:string;at:number}>();
const vehicleCache=new Map<string,{features:Feature[];at:number}>();
const PLATFORM_TTL=15*60000;
const VEHICLE_TTL=60000;
const BOARD_TTL=60000;
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
 // short, sequential, low-priority warmup resolves only the next FOUR stop
 // occurrences before the tram reaches them. No speculative full-day scan.
 useEffect(()=>{
  if(!enabled||!token||!ownFeature||!ownTripId||ownTripId==='—'||
   currentIndex===null||!stops.length)return;
  let active=true;
  const upcoming=stops.slice(currentIndex+1,currentIndex+5)
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
 const poll=Math.floor(now/60000);
 const [boardState,setBoardState]=useState<BoardState>(EMPTY);
 const [live,setLive]=useState<FeatureState>({key:'',features:[]});
 const [detail,setDetail]=useState<DetailState>({key:'',stops:new Map()});
 const cached=boardCache.get(boardId(date,selectedStopId));
 const readyBoard=boardState.key===key?boardState.board:
  cached&&Date.now()-cached.at<BOARD_TTL+30000?cached.board:null;
 // A single departureboard request contains all tram routes for this *exact*
 // GTFS platform. No more full-day GTFS trip list or per-route sequential
 // discovery before the first visible row.
 useEffect(()=>{
  if(!enabled||!token||!selectedStopId||!ownFeature){
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
   note:'PID GTFS first: exact stop_id '+selectedStopId+'; -45/+20 min; Golemio board only on failure'+
    (old?' · cached board '+Math.round((started-old.at)/1000)+' s old':' · no local cache')
  });
  setBoardState(previous=>({
   key,board:previous.key===key?previous.board:old?.board??null,
   at:previous.key===key?previous.at:old?.at??0,
   error:'',loading:true
  }));
  const ownSeconds=gtfsSeconds(stop?.arrival||stop?.departure||'');
  const source=ownSeconds===null?
   golemioJson<DepartureBoard>(departureBoardUrl([selectedStopId]),token,60000,'high'):
   staticNeighbourBoard(selectedStopId,date,ownSeconds).catch(()=>
    golemioJson<DepartureBoard>(departureBoardUrl([selectedStopId]),token,60000,'high'));
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
 },[enabled,token,key,selectedStopId,date,poll,!!ownFeature,resolved.key,resolved.error]);

 // Prefetch four following GTFS boarding edges without repeated API calls.
 useEffect(()=>{
  if(!enabled||currentIndex===null||!stops.length)return;
  let alive=true;
  const upcoming=stops.slice(currentIndex,currentIndex+5).filter(s=>!!s.id);
  const timer=window.setTimeout(()=>{
   void Promise.all(upcoming.map(async stop=>{
    const cacheKey=boardId(date,stop.id);
    if(boardCache.has(cacheKey))return;
    const secs=gtfsSeconds(stop.arrival||stop.departure||'');
    if(secs===null)return;
    try{
     const board=await staticNeighbourBoard(stop.id,date,secs);
     if(alive)boardCache.set(cacheKey,{board,at:Date.now()});
    }catch{/* GTFS unavailable, later selected stop uses safe fallback. */}
   }));
  },350);
  return()=>{alive=false;window.clearTimeout(timer);};
 },[enabled,ownTripId,date,currentIndex,stops]);

 // Build ONE enrichment snapshot per platform/refresh rather than
 // progressively re-rendering after every route's individual API response.
 // Known live positions are used immediately; cached lines avoid re-querying.
 const routes=useMemo(()=>{
  if(!readyBoard||!selectedStopId)return [];
  return [...new Set((readyBoard.departures??[]).filter(d=>
   d.stop?.id===selectedStopId&&d.route?.type===0)
   .map(d=>d.route?.short_name??'').filter(Boolean))].slice(0,10);
 },[readyBoard,selectedStopId]);
 const routeKey=routes.join('|');
 useEffect(()=>{
  if(!enabled||!token||!readyBoard||!routes.length)return;
  let active=true;
  const ownLine=ownFeature?routeOf(ownFeature):'';
  const initial=new Map(knownFeatures.map(f=>[selectedTripId(f),f]));
  const toFetch:string[]=[];
  for(const line of routes){
   if(line===ownLine)continue;
   const cache=vehicleCache.get(line);
   if(cache&&Date.now()-cache.at<VEHICLE_TTL){
    for(const feature of cache.features){
     const id=selectedTripId(feature);
     if(id&&id!=='—')initial.set(id,feature);
    }
   }else toFetch.push(line);
  }
  setLive({key,features:[...initial.values()]});
  if(!toFetch.length)return;
  // Requests are bounded to three concurrent routes and published as a
  // single complete snapshot. Late individual responses only warm the
  // cache, never reshuffle the visible list part-way through the batch.
  void (async()=>{
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
      vehicleCache.set(line,{features:fetched,at:Date.now()});
      recordNeighbourDiagnostic({...context,kind:'vehicle',at:Date.now(),
       elapsedMs:Date.now()-started,counts:{positions:fetched.length},
       note:'Vehiclepositions prepared as one coordinated batch'});
      return fetched;
     }catch(e){
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
   if(active)setLive({key,features:[...initial.values()]});
  })();
  return()=>{active=false;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,token,key,routeKey,Math.floor(now/60000)]);

 // Exact previous-stop comparison is only needed for the automatic
 // "new incoming line" trigger. It is deliberately NOT a prerequisite
 // for showing all routes in the manually opened timetable.
 useEffect(()=>{
  if(!enabled||!token||!readyBoard||!effectiveStop)return;
  let active=true;
  const initial=parseNeighbourBoard({board:readyBoard,stop:effectiveStop,ownTripId,
   ownStops:stops,ownIndex:index!,ownDelay:null,settings,distance:0,features:[]});
  const candidates=initial.rows.slice(0,10).map(row=>({
   id:row.tripId,line:row.line
  }));
  const found=new Map<string,Stop[]>();
  setDetail({key,stops:new Map()});
  void (async()=>{
   for(let start=0;start<candidates.length;start+=4){
    const batch=candidates.slice(start,start+4);
    const values=await Promise.all(batch.map(candidate=>
     tripStops(candidate.id,date,token,selectedStopId,candidate.line).catch(()=>[])));
    if(!active)return;
    batch.forEach((candidate,i)=>{
     if(values[i].length)found.set(candidate.id,values[i]);
    });
    setDetail({key,stops:new Map(found)});
   }
  })();
  return()=>{active=false;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,token,key,readyBoard,date]);

 const ownDelayRaw=path(ownFeature,'properties.last_position.delay.actual');
 const ownObserved=path(ownFeature,'properties.last_position.origin_timestamp');
 const ownStamp=typeof ownObserved==='string'?Date.parse(ownObserved):NaN;
 const ownDelay=typeof ownDelayRaw==='number'&&Number.isFinite(ownDelayRaw)&&
  Number.isFinite(ownStamp)&&now-ownStamp<=90000&&now-ownStamp>=-10000?
  ownDelayRaw:null;
 const result=useMemo(()=>{
  if(!enabled||!effectiveStop||!selectedStopId||index===null||!readyBoard)return null;
  return parseNeighbourBoard({
   board:readyBoard,stop:effectiveStop,ownTripId,ownStops:stops,ownIndex:index,ownDelay,
   settings,distance:currentIndex===null?0:Math.max(0,index-currentIndex),
   features:live.key===key?[...knownFeatures,...live.features]:knownFeatures,
   candidateStops:detail.key===key?detail.stops:undefined,now
  });
 },[enabled,effectiveStop,index,selectedStopId,readyBoard,ownTripId,stops,ownDelay,settings,currentIndex,
  live,knownFeatures,detail,key,now]);
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
   note:'Panel result after exact-platform, tram, service-time and ETA filtering'
  });
 // Logs only when board or enrichment changes, not every display countdown tick.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,readyBoard,live,detail,result]);
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
 return {result,gate,probeDepartureBoard,loading:!!activeState?.loading&&!readyBoard,
  error:activeState?.error??'',updatedAt:activeState?.at??cached?.at??0};
}
