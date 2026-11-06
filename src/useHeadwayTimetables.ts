import {useEffect,useMemo,useState} from 'react';
import {golemioJson} from './golemioClient';
import {parseStops} from './tripData';
import type {Stop} from './tripData';
import {selectedTripId} from './featureUtils';
import type {Feature} from './featureUtils';
import {headwayEligiblePeers} from './lineHeadways';

// Static GTFS includes real platform stop_id; the public /public/gtfs/trips
// endpoint used by the main display does not. Headways require the static API.
const cache=new Map<string,{stops:Stop[];at:number}>();
const TTL=6*3600000;
const endpoint=(id:string,date:string)=>{
 const url=new URL('https://api.golemio.cz/v2/gtfs/trips/'+encodeURIComponent(id));
 url.searchParams.set('date',date);
 url.searchParams.set('includeStopTimes','true');
 url.searchParams.set('includeStops','true');
 return url.toString();
};
const localDate=(now:number)=>new Intl.DateTimeFormat('sv-SE',{
 timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(now));
const hasStopIds=(stops:Stop[]):boolean=>stops.length>=2&&stops.every(s=>s.id.length>0);

export function useHeadwayTimetables(args:{
 enabled:boolean;selected:Feature|null;features:Feature[];
 currentStops:Stop[];token:string;now:number;
}):ReadonlyMap<string,Stop[]>{
 const {enabled,selected,features,currentStops,token,now}=args;
 // No stop-id filter: public GTFS has no stop IDs. Start with the selected
 // trip, then fetch nearby live vehicles on the same line.
 const ids=useMemo(()=>{
  if(!enabled||!selected||!token)return [];
  const id=selectedTripId(selected);
  if(!id||id==='—')return [];
  const candidates=headwayEligiblePeers(selected,features,currentStops,now);
  if(!candidates.length)return [];
  return [id,...candidates.map(selectedTripId)];
  // Recompute only with fresh vehicle polling or each 30s for stale detection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,selected,features,currentStops,token,Math.floor(now/30000)]);
 const date=localDate(now);
 const key=enabled&&token?date+'|'+ids.join('|'):'';
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!key||!token||!ids.length)return;
  let alive=true;
  const missing=ids.filter(id=>{
   const entry=cache.get(date+'|'+id);
   return !entry||Date.now()-entry.at>=TTL;
  });
  if(!missing.length)return;
  void (async()=>{
   for(const id of missing){
    if(!alive)return;
    try{
     const body=await golemioJson<unknown>(endpoint(id,date),token,TTL,'low');
     if(!alive)return;
     const stops=parseStops(body);
     if(hasStopIds(stops)){
      cache.set(date+'|'+id,{stops,at:Date.now()});
      if(cache.size>180)cache.delete(cache.keys().next().value!);
      setRevision(n=>n+1);
     }
    }catch{
     // An unavailable trip or rate limit must never stop the main timer.
     // Candidate set changes or a subsequent poll can retry.
    }
   }
  })();
  return()=>{alive=false;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,token]);
 return useMemo(()=>{
  const schedules=new Map<string,Stop[]>();
  for(const id of ids){
   const entry=cache.get(date+'|'+id);
   if(entry&&Date.now()-entry.at<TTL)schedules.set(id,entry.stops);
  }
  return schedules;
 },[key,revision,ids,date]);
}
