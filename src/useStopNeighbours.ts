import {useEffect,useMemo,useRef,useState} from 'react';
import type {Feature,Obj} from './featureUtils.ts';
import {path,routeOf,selectedTripId,vehicleId} from './featureUtils.ts';
import type {Stop} from './tripData.ts';
import {parseStops} from './tripData.ts';
import {golemioJson} from './golemioClient.ts';
import {calculateStopNeighbours} from './stopNeighbours.ts';
import type {NeighbourSettings} from './stopNeighbours.ts';

type StaticPlatform={ownStops:Stop[];stopId:string;tripIds:Set<string>;routes:string[]};
type Snapshot={key:string;features:Feature[];schedules:Map<string,Stop[]>;ownStops:Stop[];loading:boolean;error:string;updatedAt:number};
const EMPTY:Snapshot={key:'',features:[],schedules:new Map(),ownStops:[],loading:false,error:'',updatedAt:0};
const STATIC_TTL=6*3600000;
const details=new Map<string,{stops:Stop[];at:number}>();
const platforms=new Map<string,{data:StaticPlatform;at:number}>();
const dateLocal=(now:number)=>new Intl.DateTimeFormat('sv-SE',{
 timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(now));
const tripUrl=(id:string,date:string)=>{
 const url=new URL('https://api.golemio.cz/v2/gtfs/trips/'+encodeURIComponent(id));
 url.searchParams.set('date',date);
 url.searchParams.set('includeStopTimes','true');
 url.searchParams.set('includeStops','true');
 url.searchParams.set('includeRoute','true');
 return url.toString();
};
async function getStops(id:string,date:string,token:string):Promise<Stop[]>{
 const key=date+'|'+id,old=details.get(key);
 if(old&&Date.now()-old.at<STATIC_TTL)return old.stops;
 const json=await golemioJson<unknown>(tripUrl(id,date),token,STATIC_TTL,'low');
 const stops=parseStops(json);
 if(stops.length){
  details.set(key,{stops,at:Date.now()});
  if(details.size>300)details.delete(details.keys().next().value!);
 }
 return stops;
}
const routeFrom=(item:unknown):string=>{
 const known=path(item,'route.route_short_name')??path(item,'route_short_name');
 if(known!==null&&known!==undefined&&String(known))return String(known);
 const id=String(path(item,'route_id')??'');
 return /^L\d+$/.test(id)?id.slice(1):/^\d{1,3}$/.test(id)?id:'';
};
const array=(raw:unknown):Obj[]=>{
 if(Array.isArray(raw))return raw as Obj[];
 if(raw&&typeof raw==='object'){
  const obj=raw as Obj;
  for(const name of ['data','trips','items','results'])if(Array.isArray(obj[name]))return obj[name] as Obj[];
 }
 return [];
};
async function getPlatform(tripId:string,index:number,date:string,token:string):Promise<StaticPlatform>{
 const ownStops=await getStops(tripId,date,token);
 const stopId=ownStops[index]?.id??'';
 if(!stopId)throw Error('Online GTFS nevrátilo přesné ID této nástupní hrany.');
 const key=date+'|'+stopId,old=platforms.get(key);
 if(old&&Date.now()-old.at<STATIC_TTL)return {...old.data,ownStops};
 const url=new URL('https://api.golemio.cz/v2/gtfs/trips');
 url.searchParams.set('date',date);
 url.searchParams.set('stopId',stopId);
 url.searchParams.set('limit','2000');
 url.searchParams.set('includeRoute','true');
 const raw=await golemioJson<unknown>(url.toString(),token,STATIC_TTL,'low');
 const items=array(raw);
 const routes=new Set<string>(),tripIds=new Set<string>();
 for(const item of items){
  const route=routeFrom(item),id=String(path(item,'trip_id')??'');
  if(route)routes.add(route);
  if(id)tripIds.add(id);
 }
 if(!items.length)throw Error('Online GTFS nevrátilo spoje pro tuto nástupní hranu.');
 const data={ownStops,stopId,routes:[...routes].slice(0,8),tripIds};
 platforms.set(key,{data,at:Date.now()});
 if(platforms.size>100)platforms.delete(platforms.keys().next().value!);
 return data;
}

export function useStopNeighbours(args:{
 enabled:boolean;token:string;now:number;ownFeature:Feature|null;
 ownTripId:string;stops:Stop[];currentIndex:number|null;
 requestedIndex:number|null;settings:NeighbourSettings;
}){
 const {enabled,token,now,ownFeature,ownTripId,currentIndex,requestedIndex,settings}=args;
 const index=requestedIndex??currentIndex;
 const date=dateLocal(now);
 const key=date+'|'+ownTripId+'|'+String(index??'');
 const [platform,setPlatform]=useState<{key:string;data:StaticPlatform|null;error:string}>({key:'',data:null,error:''});
 const [snapshot,setSnapshot]=useState<Snapshot>(EMPTY);
 const [loadingPlatform,setLoadingPlatform]=useState(false);
 const poll=Math.floor(now/30000);
 const liveKeyRef=useRef('');
 liveKeyRef.current=enabled?key:'';
 const liveBusyRef=useRef('');
 // Static data are obtained once per selected stop and GTFS service day.
 // Crucially, the 30-second live refresh never restarts this request chain.
 useEffect(()=>{
  if(!enabled||!token||!ownFeature||!ownTripId||index===null){
   setPlatform({key:'',data:null,error:''});setLoadingPlatform(false);return;
  }
  let valid=true;
  setLoadingPlatform(true);
  setPlatform(old=>old.key===key?old:{key,data:null,error:''});
  void getPlatform(ownTripId,index,date,token).then(data=>{
   if(valid)setPlatform({key,data,error:''});
  }).catch(e=>{
   if(valid)setPlatform({key,data:null,error:e instanceof Error?e.message:String(e)});
  }).finally(()=>{if(valid)setLoadingPlatform(false);});
  return()=>{valid=false;};
 },[enabled,token,ownTripId,index,date,key,!!ownFeature]);
 const activePlatform=platform.key===key?platform.data:null;
 const routeKey=activePlatform?.routes.join('|')??'';
 // Live vehicle positions have their own refresh cycle. The last successful
 // result stays visible while a refresh is in progress.
 useEffect(()=>{
  if(!enabled||!token||!activePlatform||!ownFeature)return;
  // A 30-second tick must not cancel a slower in-progress batch. Otherwise
  // platforms with many routes can stay stuck at "Načítám" indefinitely.
  if(liveBusyRef.current===key)return;
  liveBusyRef.current=key;
  const valid=()=>liveKeyRef.current===key;
  setSnapshot(old=>old.key===key?{...old,loading:true,error:''}:{
   key,features:[],schedules:new Map(),ownStops:activePlatform.ownStops,
   loading:true,error:'',updatedAt:0
  });
  const run=async()=>{
   const routes=[...new Set([routeOf(ownFeature),...activePlatform.routes])].filter(Boolean).slice(0,9);
   const received:Feature[]=[];
   // Fast first paint: query routes first, then only matching live trip details.
   // No per-vehicle GTFS fetches for trams absent from this precise platform.
   for(const line of routes){
    const url=new URL('https://api.golemio.cz/v2/vehiclepositions');
    url.searchParams.set('routeShortName',line);
    url.searchParams.set('limit','1000');
    try{
     const raw=await golemioJson<unknown>(url.toString(),token,20000,'low');
     const v=path(raw,'features');
     if(Array.isArray(v))received.push(...v as Feature[]);
    }catch{/* Other lines remain usable. */}
    if(!valid())return;
   }
   const seen=new Set<string>();
   const candidates=received.filter(f=>{
    const id=selectedTripId(f);
    if(id==='—'||id===ownTripId||vehicleId(f)===vehicleId(ownFeature)||
     seen.has(id)||!activePlatform.tripIds.has(id))return false;
    seen.add(id);
    return true;
   }).slice(0,24);
   const schedules=new Map<string,Stop[]>();
   for(let i=0;i<candidates.length;i+=6){
    const slice=candidates.slice(i,i+6);
    const results=await Promise.all(slice.map(f=>getStops(selectedTripId(f),date,token).catch(()=>[])));
    if(!valid())return;
    slice.forEach((f,n)=>{if(results[n].length)schedules.set(selectedTripId(f),results[n]);});
    // Incremental reveal, not an empty spinner until the very last trip loads.
    setSnapshot({key,features:candidates,schedules:new Map(schedules),
     ownStops:activePlatform.ownStops,loading:i+6<candidates.length,error:'',updatedAt:Date.now()});
   }
   if(valid())setSnapshot({key,features:candidates,schedules,
    ownStops:activePlatform.ownStops,loading:false,error:'',updatedAt:Date.now()});
  };
  void run().catch(e=>{
   if(valid())setSnapshot(old=>({...old,key,loading:false,error:String(e)}));
  }).finally(()=>{if(liveBusyRef.current===key)liveBusyRef.current='';});
 },[enabled,token,key,routeKey,poll,activePlatform?.stopId,ownTripId]);
 const result=useMemo(()=>{
  if(!enabled||snapshot.key!==key||index===null||!ownFeature)return null;
  return calculateStopNeighbours({
   ownTripId,ownStops:snapshot.ownStops,ownIndex:index,ownFeature,
   candidates:snapshot.features,candidateStops:snapshot.schedules,now,settings,
   distance:currentIndex===null?0:Math.max(0,index-currentIndex)
  });
 },[enabled,snapshot,key,index,ownTripId,ownFeature,now,settings,currentIndex]);
 const staticError=platform.key===key?platform.error:'';
 return {result,loading:loadingPlatform||(snapshot.key===key&&snapshot.loading),
  error:staticError||(snapshot.key===key?snapshot.error:''),updatedAt:snapshot.key===key?snapshot.updatedAt:0};
}
