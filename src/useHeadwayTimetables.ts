import {useEffect,useMemo,useState} from 'react';
import {golemioJson} from './golemioClient';
import {parseStops} from './tripData';
import type {Stop} from './tripData';
import {routeOf,selectedTripId,vehicleId} from './featureUtils';
import type {Feature,Obj} from './featureUtils';
import {headwayEligiblePeers} from './lineHeadways';
import {joinHeadwayBlock,possibleBlockPartners} from './headwayChains';
import type {HeadwayTripDetail} from './headwayChains';

const TTL=6*3600000;
const detailCache=new Map<string,{detail:HeadwayTripDetail;at:number}>();
const serviceCache=new Map<string,{stops:Stop[];at:number}>();
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
async function getDetail(id:string,date:string,token:string):Promise<HeadwayTripDetail|null>{
 const key=date+'|'+id,old=detailCache.get(key);
 if(old&&Date.now()-old.at<TTL)return old.detail;
 try{
  const detail=await golemioJson<HeadwayTripDetail>(detailUrl(id,date),token,TTL,'low');
  if(detail?.trip_id!==id)return null;
  detailCache.set(key,{detail,at:Date.now()});
  if(detailCache.size>240)detailCache.delete(detailCache.keys().next().value!);
  return detail;
 }catch{return null;}
}
const stopListUrl=(stopId:string,date:string)=>{
 const url=new URL('https://api.golemio.cz/v2/gtfs/trips');
 url.searchParams.set('date',date);
 url.searchParams.set('stopId',stopId);
 url.searchParams.set('limit','2000');
 return url.toString();
};
async function candidatesForTerminal(stopId:string,date:string,token:string):Promise<HeadwayTripDetail[]>{
 if(!stopId)return [];
 try{
  const response=await golemioJson<unknown>(stopListUrl(stopId,date),token,15*60000,'low');
  return Array.isArray(response)?response as HeadwayTripDetail[]:[];
 }catch{return [];}
}
const stopIdsOk=(stops:Stop[])=>stops.length>1&&stops.every(s=>!!s.id);

/**
 * Only the optional spacing display does these requests. First discover
 * vehicles on the adjacent chain line, then load their static schedules.
 * Candidate GTFS blocks are verified independently of a vehicle/order match.
 */
export function useHeadwayTimetables(args:{
 enabled:boolean;selected:Feature|null;features:Feature[];currentStops:Stop[];
 token:string;now:number;companionLine:string;companionTripId:string;
}):{schedules:ReadonlyMap<string,Stop[]>;features:Feature[];allowedRoutes:ReadonlySet<string>}{
 const {enabled,selected,features,currentStops,token,now,companionLine,companionTripId}=args;
 const date=dateLocal(now);
 const primaryLine=selected?routeOf(selected):'';
 const foreignLine=companionLine&&companionLine!==primaryLine?companionLine:'';
 const allowedRoutes=useMemo(()=>new Set([primaryLine,...(foreignLine?[foreignLine]:[])]),
  [primaryLine,foreignLine]);
 const [foreign,setForeign]=useState<{line:string;features:Feature[]}>({line:'',features:[]});
 const [revision,setRevision]=useState(0);
 // Keep the second line's live positions fresh, without disturbing existing
 // position tracking and without querying it if the chain is not verified.
 const interval=Math.floor(now/20000);
 useEffect(()=>{
  if(!enabled||!token||!foreignLine){setForeign({line:'',features:[]});return;}
  let alive=true;
  const url=new URL('https://api.golemio.cz/v2/vehiclepositions');
  url.searchParams.set('routeShortName',foreignLine);
  url.searchParams.set('limit','1000');
  url.searchParams.set('includeNotTracking','true');
  void golemioJson<unknown>(url.toString(),token,20000,'low').then(body=>{
   if(!alive)return;
   const list=body&&typeof body==='object'&&Array.isArray((body as Obj).features)?
    (body as {features:Feature[]}).features:[];
   setForeign({line:foreignLine,features:list});
  }).catch(()=>{if(alive)setForeign({line:foreignLine,features:[]});});
  return()=>{alive=false;};
 },[enabled,token,foreignLine,interval]);
 const allFeatures=useMemo(()=>{
  const result=[...features];
  if(foreign.line===foreignLine&&foreignLine){
   const seen=new Set(features.map(f=>routeOf(f)+'|'+selectedTripId(f)+'|'+vehicleId(f)));
   for(const candidate of foreign.features){
    const key=routeOf(candidate)+'|'+selectedTripId(candidate)+'|'+vehicleId(candidate);
    if(!seen.has(key)){result.push(candidate);seen.add(key);}
   }
  }
  return result;
 },[features,foreign,foreignLine]);
 const ids=useMemo(()=>{
  if(!enabled||!selected||!token)return [];
  const id=selectedTripId(selected);
  if(!id||id==='—')return [];
  const peers=headwayEligiblePeers(selected,allFeatures,currentStops,now,64,allowedRoutes);
  // Always retain a few nearby trips of each operating line, and make the
  // candidate key independent of geometry-driven ordering changes.
  const same=peers.filter(f=>routeOf(f)===primaryLine).slice(0,24);
  const cross=peers.filter(f=>routeOf(f)===foreignLine).slice(0,24);
  return [...new Set([id,...(companionTripId?[companionTripId]:[]),
   ...[...same,...cross].map(selectedTripId).sort()])];
  // Vehicle snapshots refresh the candidate set. Do not restart per second.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,selected,allFeatures,currentStops,token,companionTripId,foreignLine,Math.floor(now/30000)]);
 const activeKey=date+'|'+ids.join('|')+'|'+foreignLine;
 useEffect(()=>{
  if(!enabled||!token||!selected||!ids.length)return;
  let alive=true;
  const run=async()=>{
   // Cache is updated even when snapshots change during slow GTFS requests.
   // Rendering only uses the latest active set; abandoned requests do not
   // overwrite any current-trip identity.
   const details=new Map<string,HeadwayTripDetail>();
   // Bounded concurrency avoids serial delays with many diversions/short
   // turns, while respecting the existing shared request cache.
   for(let start=0;start<ids.length;start+=6){
    const batch=ids.slice(start,start+6);
    const values=await Promise.all(batch.map(id=>getDetail(id,date,token)));
    if(!alive)return;
    batch.forEach((id,i)=>{if(values[i])details.set(id,values[i]!);});
   }
   const selectedId=selectedTripId(selected);
   const selectedDetail=details.get(selectedId);
   // If a verified companion is already known from the existing chain module,
   // it can be used even if live GPS has switched to the second trip.
   const selectedCompanion=companionTripId?details.get(companionTripId):null;
   const activePair=selectedDetail&&selectedCompanion?joinHeadwayBlock(selectedDetail,selectedCompanion):null;
   const lookups=new Map<string,Promise<HeadwayTripDetail[]>>();
   const listed=(stopId:string)=>{
    if(!lookups.has(stopId))lookups.set(stopId,candidatesForTerminal(stopId,date,token));
    return lookups.get(stopId)!;
   };
   for(const id of ids){
    if(!alive)return;
    const detail=details.get(id);
    if(!detail)continue;
    const rawStops=parseStops(detail);
    if(!stopIdsOk(rawStops))continue;
    let combined:Stop[]=rawStops;
    if(id===selectedId&&activePair)combined=activePair.stops;
    else if(foreignLine&&id!==selectedId&&detail.route?.route_short_name===foreignLine&&detail.block_id){
     let partner:HeadwayTripDetail|null=null;
     // The first trip of a PID block is commonly addressable as block_id.
     if(detail.block_id!==id){
      partner=await getDetail(detail.block_id,date,token);
     }else{
      // The successor is not identifiable from the first trip ID. Search
      // the common terminal's GTFS trip list for an exact matching block.
      const lastId=rawStops[rawStops.length-1]?.id;
      const possible=possibleBlockPartners(detail,await listed(lastId),foreignLine)
       .slice(0,6);
      for(const candidateId of possible){
       if(candidateId===id)continue;
       const found=await getDetail(candidateId,date,token);
       if(found&&joinHeadwayBlock(detail,found)){partner=found;break;}
      }
     }
     if(partner&&partner.route?.route_short_name!==detail.route.route_short_name){
      const verified=joinHeadwayBlock(detail,partner);
      if(verified)combined=verified.stops;
     }
    }
    serviceCache.set(date+'|'+id,{stops:combined,at:Date.now()});
    if(serviceCache.size>240)serviceCache.delete(serviceCache.keys().next().value!);
    if(alive)setRevision(v=>v+1);
   }
  };
  void run();
  return()=>{alive=false;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,token,activeKey,companionTripId]);
 const schedules=useMemo(()=>{
  const result=new Map<string,Stop[]>();
  if(!enabled)return result;
  for(const id of ids){
   const entry=serviceCache.get(date+'|'+id);
   if(entry&&Date.now()-entry.at<TTL)result.set(id,entry.stops);
  }
  return result;
 },[enabled,date,activeKey,revision,ids]);
 return {schedules,features:allFeatures,allowedRoutes};
}
