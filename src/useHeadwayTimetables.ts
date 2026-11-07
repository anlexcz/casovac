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
 const [discovered,setDiscovered]=useState<{key:string;lines:string[]}>({key:'',lines:[]});
 const [foreign,setForeign]=useState<{key:string;features:Feature[]}>({key:'',features:[]});
 const [revision,setRevision]=useState(0);
 const discoveryPeers=selected?headwayEligiblePeers(selected,features,currentStops,now,64)
  .filter(f=>routeOf(f)===primaryLine).slice(0,24).map(selectedTripId).sort():[];
 const discoveryKey=date+'|'+primaryLine+'|'+(selected?selectedTripId(selected):'')+'|'+discoveryPeers.join('|');
 // Inspect the block identity of the selected service and its same-line
 // neighbours. Different chained services can lead to different lines.
 useEffect(()=>{
  if(!enabled||!token||!selected||!primaryLine){setDiscovered({key:'',lines:[]});return;}
  let alive=true;
  const run=async()=>{
   const ids=[...new Set([selectedTripId(selected),...discoveryPeers])];
   const found=new Set<string>();
   if(companionLine&&companionLine!==primaryLine)found.add(companionLine);
   for(let i=0;i<ids.length;i+=6){
    const details=await Promise.all(ids.slice(i,i+6).map(id=>getDetail(id,date,token)));
    if(!alive)return;
    for(const detail of details){
     if(!detail?.block_id)continue;
     const stops=parseStops(detail);
     const candidates:HeadwayTripDetail[]=[];
     if(detail.block_id!==detail.trip_id){
      const first=await getDetail(detail.block_id,date,token);
      if(first)candidates.push(first);
     }
     if(stops.length){
      const terminal=stops[stops.length-1]?.id;
      const listed=await candidatesForTerminal(terminal,date,token);
      for(const item of listed.filter(item=>item.block_id===detail.block_id&&item.trip_id!==detail.trip_id).slice(0,12)){
       const full=await getDetail(item.trip_id!,date,token);
       if(full)candidates.push(full);
      }
     }
     if(!alive)return;
     for(const candidate of candidates){
      if(joinHeadwayBlock(detail,candidate)){
       const line=candidate.route?.route_short_name;
       if(line&&line!==primaryLine)found.add(line);
      }
     }
    }
   }
   if(alive)setDiscovered({key:discoveryKey,lines:[...found].slice(0,6)});
  };
  void run();
  return()=>{alive=false;};
 // Discovery is tied to service identity, not per-second UI ticks.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,token,discoveryKey]);
 const foreignLines=discovered.key===discoveryKey?discovered.lines:
  companionLine&&companionLine!==primaryLine?[companionLine]:[];
 const foreignKey=foreignLines.join('|');
 const allowedRoutes=useMemo(()=>new Set([primaryLine,...foreignLines]),[primaryLine,foreignKey]);
 const interval=Math.floor(now/20000);
 useEffect(()=>{
  if(!enabled||!token||!foreignLines.length){setForeign({key:'',features:[]});return;}
  let alive=true;
  const run=async()=>{
   const values=await Promise.all(foreignLines.map(async line=>{
    try{
     const url=new URL('https://api.golemio.cz/v2/vehiclepositions');
     url.searchParams.set('routeShortName',line);
     url.searchParams.set('limit','1000');
     url.searchParams.set('includeNotTracking','true');
     const body=await golemioJson<unknown>(url.toString(),token,20000,'low');
     return body&&typeof body==='object'&&Array.isArray((body as Obj).features)?
      (body as {features:Feature[]}).features:[];
    }catch{return [];}
   }));
   if(alive)setForeign({key:foreignKey,features:values.flat()});
  };
  void run();
  return()=>{alive=false;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,token,foreignKey,interval]);
 const allFeatures=useMemo(()=>{
  const result=[...features];
  if(foreign.key===foreignKey&&foreignKey){
   const seen=new Set(features.map(f=>routeOf(f)+'|'+selectedTripId(f)+'|'+vehicleId(f)));
   for(const candidate of foreign.features){
    const key=routeOf(candidate)+'|'+selectedTripId(candidate)+'|'+vehicleId(candidate);
    if(!seen.has(key)){result.push(candidate);seen.add(key);}
   }
  }
  return result;
 },[features,foreign,foreignKey]);
 const ids=useMemo(()=>{
  if(!enabled||!selected||!token)return [];
  const id=selectedTripId(selected);
  if(!id||id==='—')return [];
  const peers=headwayEligiblePeers(selected,allFeatures,currentStops,now,64,allowedRoutes);
  // Always retain a few nearby trips of each operating line, and make the
  // candidate key independent of geometry-driven ordering changes.
  const same=peers.filter(f=>routeOf(f)===primaryLine).slice(0,24);
  const cross=peers.filter(f=>foreignLines.includes(routeOf(f))).slice(0,48);
  return [...new Set([id,...(companionTripId?[companionTripId]:[]),
   ...[...same,...cross].map(selectedTripId).sort()])];
  // Vehicle snapshots refresh the candidate set. Do not restart per second.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,selected,allFeatures,currentStops,token,companionTripId,foreignKey,Math.floor(now/30000)]);
 const activeKey=date+'|'+ids.join('|')+'|'+foreignKey;
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
   const selectedCompanion=companionTripId?details.get(companionTripId)??await getDetail(companionTripId,date,token):null;
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
    else if(foreignLines.includes(detail.route?.route_short_name??'')&&id!==selectedId&&detail.block_id){
     let partner:HeadwayTripDetail|null=null;
     // The first trip of a PID block is commonly addressable as block_id.
     if(detail.block_id!==id){
      partner=await getDetail(detail.block_id,date,token);
     }else{
      // The successor is not identifiable from the first trip ID. Search
      // the common terminal's GTFS trip list for an exact matching block.
      const lastId=rawStops[rawStops.length-1]?.id;
      const possible=possibleBlockPartners(detail,await listed(lastId),primaryLine)
       .slice(0,6);
      for(const candidateId of possible){
       if(candidateId===id)continue;
       const found=await getDetail(candidateId,date,token);
       if(found&&joinHeadwayBlock(detail,found)){partner=found;break;}
      }
     }
     if(partner&&partner.route?.route_short_name!==detail.route?.route_short_name){
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
