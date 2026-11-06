import {useEffect,useMemo,useState} from 'react';
import {golemioJson} from './golemioClient';
import {parseStops} from './tripData';
import type {Stop} from './tripData';
import {selectedTripId} from './featureUtils';
import type {Feature} from './featureUtils';
import {headwayEligiblePeers} from './lineHeadways';

// Public timetable cache, shared between rerenders/line changes; no credentials.
const cache=new Map<string,{stops:Stop[];at:number}>();
const TTL=6*3600000;
const endpoint=(id:string)=>{
 const url=new URL('https://api.golemio.cz/v2/public/gtfs/trips/'+encodeURIComponent(id));
 url.searchParams.append('scopes[]','info');
 url.searchParams.append('scopes[]','stop_times');
 return url.toString();
};
export function useHeadwayTimetables(args:{
 enabled:boolean;selected:Feature|null;features:Feature[];
 currentStops:Stop[];token:string;now:number;
}):ReadonlyMap<string,Stop[]>{
 const {enabled,selected,features,currentStops,token,now}=args;
 // Recalculate candidates only when a new vehiclepositions response arrives.
 const candidateIds=useMemo(()=>enabled?
  headwayEligiblePeers(selected,features,currentStops,now).map(selectedTripId):[],
  // Intentional: no re-fetch on every one-second clock tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [enabled,selected,features,currentStops,Math.floor(now/30000)]);
 const key=enabled&&token?candidateIds.join('|'):'';
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!key||!token)return;
  let alive=true;
  const missing=candidateIds.filter(id=>{
   const cached=cache.get(id);
   return !cached||Date.now()-cached.at>=TTL;
  });
  if(!missing.length)return;
  void (async()=>{
   // Sequential LOW priority requests; live vehicle polling retains priority.
   for(const id of missing){
    if(!alive)return;
    try{
     const body=await golemioJson<unknown>(endpoint(id),token,TTL,'low');
     if(!alive)return;
     const stops=parseStops(body);
     if(stops.length>1){
      cache.set(id,{stops,at:Date.now()});
      if(cache.size>150)cache.delete(cache.keys().next().value!);
      setRevision(n=>n+1);
     }
    }catch{
     // Missing GTFS or rate limits cannot interrupt the running timer.
     // A later changed set of candidates can trigger another attempt.
    }
   }
  })();
  return()=>{alive=false;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,token]);
 return useMemo(()=>{
  const available=new Map<string,Stop[]>();
  for(const id of candidateIds){
   const entry=cache.get(id);
   if(entry&&Date.now()-entry.at<TTL)available.set(id,entry.stops);
  }
  return available;
 },[key,revision,candidateIds]);
}
