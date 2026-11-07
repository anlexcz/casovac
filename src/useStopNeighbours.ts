import {useEffect,useMemo,useState} from 'react';
import type {Feature,Obj} from './featureUtils.ts';
import {path,routeOf,selectedTripId,vehicleId} from './featureUtils.ts';
import type {Stop} from './tripData.ts';
import {parseStops} from './tripData.ts';
import {golemioJson} from './golemioClient.ts';
import {calculateStopNeighbours} from './stopNeighbours.ts';
import type {NeighbourSettings} from './stopNeighbours.ts';

type Entry={id:string;stops:Stop[]};
type Snapshot={key:string;features:Feature[];schedules:Map<string,Stop[]>;loading:boolean;error:string};
const cachedDetails=new Map<string,{stops:Stop[];at:number}>();
const clock=(v:string)=>{const m=/^(\d{1,2}):(\d{2})/.exec(v);return m?Number(m[1])*60+Number(m[2]):null;};
const dateLocal=(now:number)=>new Intl.DateTimeFormat('sv-SE',{
 timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(now));
const detailUrl=(id:string,date:string)=>{
 const url=new URL('https://api.golemio.cz/v2/gtfs/trips/'+encodeURIComponent(id));
 url.searchParams.set('date',date);
 url.searchParams.set('includeStopTimes','true');
 url.searchParams.set('includeStops','true');
 url.searchParams.set('includeRoute','true');
 return url.toString();
};
async function getStops(id:string,date:string,token:string):Promise<Stop[]>{
 const key=date+'|'+id,old=cachedDetails.get(key);
 if(old&&Date.now()-old.at<6*3600000)return old.stops;
 try{
  const detail=await golemioJson<unknown>(detailUrl(id,date),token,6*3600000,'low');
  const stops=parseStops(detail);
  if(stops.length){cachedDetails.set(key,{stops,at:Date.now()});
   if(cachedDetails.size>260)cachedDetails.delete(cachedDetails.keys().next().value!);}
  return stops;
 }catch{return [];}
}
export function useStopNeighbours(args:{
 enabled:boolean;token:string;now:number;ownFeature:Feature|null;
 ownTripId:string;stops:Stop[];currentIndex:number|null;
 requestedIndex:number|null;settings:NeighbourSettings;
}){
 const {enabled,token,now,ownFeature,ownTripId,stops,currentIndex,requestedIndex,settings}=args;
 const selectedIndex=requestedIndex??currentIndex;
 const selectedStop=selectedIndex!==null?stops[selectedIndex]:null;
 const stopId=selectedStop?.id??'';
 const date=dateLocal(now);
 const key=date+'|'+ownTripId+'|'+stopId;
 const [snapshot,setSnapshot]=useState<Snapshot>({key:'',features:[],schedules:new Map(),loading:false,error:''});
 const poll=Math.floor(now/30000);
 useEffect(()=>{
  if(!enabled||!token||!ownFeature||!stopId||!ownTripId){setSnapshot({key:'',features:[],schedules:new Map(),loading:false,error:''});return;}
  let live=true;
  setSnapshot(old=>old.key===key?{...old,loading:true}:{key,features:[],schedules:new Map(),loading:true,error:''});
  const run=async()=>{
   try{
    // Stop-scoped GTFS discovery; never download the whole network.
    const lookup=new URL('https://api.golemio.cz/v2/gtfs/trips');
    lookup.searchParams.set('date',date);
    lookup.searchParams.set('stopId',stopId);
    lookup.searchParams.set('limit','2000');
    const raw=await golemioJson<unknown>(lookup.toString(),token,15*60000,'low');
    if(!live)return;
    const candidates=Array.isArray(raw)?raw as Obj[]:[];
    const routes=new Set<string>();
    for(const item of candidates){
     const route=String(path(item,'route.route_short_name')??path(item,'route_short_name')??'');
     if(route&&route!==routeOf(ownFeature))routes.add(route);
    }
    // Route discovery from summaries is bounded; missing route metadata
    // means no speculative or network-wide vehicleposition queries.
    const routeList=[...routes].slice(0,8);
    const all:Feature[]=[];
    for(const line of [routeOf(ownFeature),...routeList]){
     if(!line)continue;
     const url=new URL('https://api.golemio.cz/v2/vehiclepositions');
     url.searchParams.set('routeShortName',line);
     url.searchParams.set('limit','1000');
     try{
      const result=await golemioJson<unknown>(url.toString(),token,20000,'low');
      if(result&&typeof result==='object'&&Array.isArray((result as Obj).features))
       all.push(...(result as {features:Feature[]}).features);
     }catch{/* One unavailable route does not hide the others. */}
     if(!live)return;
    }
    const seen=new Set<string>();
    const unique=all.filter(f=>{
     const id=selectedTripId(f),car=vehicleId(f);
     if(id==='—'||id===ownTripId||car===vehicleId(ownFeature)||seen.has(id))return false;
     seen.add(id);
     return true;
    });
    const ownMinutes=clock(selectedStop?.arrival||selectedStop?.departure||'');
    const plausible=unique.filter(f=>{
     const item=candidates.find(x=>String(path(x,'trip_id')??'')===selectedTripId(f));
     if(!item)return false;
     const listed=path(item,'stop_times');
     if(Array.isArray(listed)&&ownMinutes!==null){
      const target=listed.find(x=>String(path(x,'stop_id')??'')===stopId);
      const time=clock(String(path(target,'arrival_time')??path(target,'departure_time')??''));
      if(time!==null&&Math.abs(time-ownMinutes)>35)return false;
     }
     return true;
    }).slice(0,24);
    const schedules=new Map<string,Stop[]>();
    for(let n=0;n<plausible.length;n+=5){
     const batch=plausible.slice(n,n+5);
     const results=await Promise.all(batch.map(f=>getStops(selectedTripId(f),date,token)));
     if(!live)return;
     batch.forEach((f,i)=>{if(results[i].length)schedules.set(selectedTripId(f),results[i]);});
    }
    if(live)setSnapshot({key,features:plausible,schedules,loading:false,error:''});
   }catch(e){
    if(live)setSnapshot({key,features:[],schedules:new Map(),loading:false,error:e instanceof Error?e.message:String(e)});
   }
  };
  void run();
  return()=>{live=false;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,token,key,poll]);
 const result=useMemo(()=>{
  if(!enabled||snapshot.key!==key||selectedIndex===null)return null;
  return calculateStopNeighbours({
   ownTripId,ownStops:stops,ownIndex:selectedIndex,ownFeature,
   candidates:snapshot.features,candidateStops:snapshot.schedules,now,settings,
   distance:currentIndex===null?0:Math.max(0,selectedIndex-currentIndex)
  });
 },[enabled,snapshot,key,selectedIndex,ownTripId,stops,ownFeature,now,settings,currentIndex]);
 return {result,loading:enabled&&snapshot.key===key?snapshot.loading:false,
  error:enabled&&snapshot.key===key?snapshot.error:''};
}
