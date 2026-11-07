import {useEffect,useMemo,useState} from 'react';
import {stateOf} from './tripSelection';
import {useChooserStops} from './chooserStops';
import type {ChooserTarget} from './chooserStops';
import {golemioJson} from './golemioClient';
import {path,vehicleId,selectedTripId} from './featureUtils';
import type {Feature,Obj} from './featureUtils';
import {parseChooserQuery,resolveChooserMatches} from './chooserSearch';

const API='https://api.golemio.cz/v2/vehiclepositions';
type Snapshot={key:string;items:Feature[];error:string;loading:boolean;ready:boolean};
const EMPTY:Snapshot={key:'',items:[],error:'',loading:false,ready:false};
async function loadVehicles(token:string,line?:string):Promise<Feature[]>{
 const url=new URL(API);
 if(line)url.searchParams.set('routeShortName',line);
 url.searchParams.set('includeNotTracking','true');
 url.searchParams.set('limit',line?'1000':'3000');
 // The shared coordinator caches the same URL and coalesces concurrent
 // requests. Cross-route searches refresh at most once every 45 seconds.
 const body:unknown=await golemioJson<unknown>(url.toString(),token,30000,'high');
 if(!body||typeof body!=='object'||!Array.isArray((body as Obj).features))
  throw Error('Neplatná odpověď Golemia');
 return (body as {features:Feature[]}).features;
}
export function useOrderLookup(query:string,editing:boolean,token:string,now:number){
 const search=parseChooserQuery(query);
 const lookupLine=search.kind==='route'||search.kind==='order'?search.line:'';
 const lookupOrder=search.kind==='order'?[search.line,search.order] as [string,string]:null;
 const crossRoute=search.kind==='order'||search.kind==='vehicle';
 const [routeSnapshot,setRouteSnapshot]=useState<Snapshot>(EMPTY);
 const [globalSnapshot,setGlobalSnapshot]=useState<Snapshot>(EMPTY);
 const secret=token.trim();

 useEffect(()=>{
  if(!editing||!lookupLine||!secret)return;
  let alive=true;
  const refresh=async()=>{
   setRouteSnapshot(old=>({...old,key:lookupLine,
    items:old.key===lookupLine?old.items:[],error:'',loading:true,ready:old.key===lookupLine&&old.ready}));
   try{
    const items=await loadVehicles(secret,lookupLine);
    if(alive)setRouteSnapshot({key:lookupLine,items,error:'',loading:false,ready:true});
   }catch(e){
    if(alive)setRouteSnapshot(old=>({key:lookupLine,
     items:old.key===lookupLine?old.items:[],
     error:e instanceof Error?e.message:String(e),loading:false,ready:true}));
   }
  };
  const first=window.setTimeout(()=>void refresh(),220);
  const interval=window.setInterval(()=>void refresh(),45000);
  return()=>{alive=false;window.clearTimeout(first);window.clearInterval(interval);};
 },[editing,lookupLine,secret]);

 useEffect(()=>{
  if(!editing||!crossRoute||!secret)return;
  let alive=true;
  const refresh=async()=>{
   setGlobalSnapshot(old=>({...old,key:secret,items:old.key===secret?old.items:[],
    error:'',loading:true,ready:old.key===secret&&old.ready}));
   try{
    const items=await loadVehicles(secret);
    if(alive)setGlobalSnapshot({key:secret,items,error:'',loading:false,ready:true});
   }catch(e){
    if(alive)setGlobalSnapshot(old=>({key:secret,
     items:old.key===secret?old.items:[],
     error:e instanceof Error?e.message:String(e),loading:false,ready:true}));
   }
  };
  const first=window.setTimeout(()=>void refresh(),260);
  const interval=window.setInterval(()=>void refresh(),45000);
  return()=>{alive=false;window.clearTimeout(first);window.clearInterval(interval);};
 },[editing,crossRoute,secret]);

 const route=routeSnapshot.key===lookupLine&&!!lookupLine?routeSnapshot:EMPTY;
 const all=globalSnapshot.key===secret&&crossRoute?globalSnapshot:EMPTY;
 const items=useMemo(()=>[
  ...(lookupLine?route.items:[]),...(crossRoute?all.items:[])
 ],[route.items,all.items,lookupLine,crossRoute]);
 const matches=useMemo(()=>resolveChooserMatches(items,search,now),
  // Selection depends on trip states and not the app's per-second clock.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items,query,Math.floor(now/30000)]);
 const available=matches.map(match=>{
  const chosen=match.feature,car=vehicleId(chosen),state=stateOf(chosen);
  const next=path(chosen,'properties.last_position.next_stop');
  const last=path(chosen,'properties.last_position.last_stop');
  const nextObj=next&&typeof next==='object'?next as Obj:null;
  const nextId=String(nextObj?.id??(typeof next==='string'?next:''));
  const seq=nextObj?.sequence;
  const future=items.filter(f=>vehicleId(f)===car&&stateOf(f).startsWith('before_track'))
   .sort((a,b)=>Date.parse(String(path(a,'properties.trip.start_timestamp')??''))-
    Date.parse(String(path(b,'properties.trip.start_timestamp')??'')))[0];
  const atTerminal=state.startsWith('after_track')||state.startsWith('before_track')||(!next&&!!future);
  const rawName=nextObj?.name??(last&&typeof last==='object'?(last as Obj).name:undefined);
  const target:ChooserTarget={
   tripId:selectedTripId(chosen),fallbackTripId:future?selectedTripId(future):'',
   nextId,nextSequence:seq!==undefined&&seq!==null&&Number.isFinite(Number(seq))?Number(seq):null,
   directName:typeof rawName==='string'?rawName:'',atTerminal
  };
  return {line:match.line,order:match.order,originRoute:match.originRoute,
   car:match.car,ambiguous:match.ambiguous,target};
 });
 const stopNames=useChooserStops(available.map(v=>v.target),secret,editing&&search.kind!=='invalid');
 const needRoute=!!lookupLine;
 const lookupReady=(!needRoute||route.ready)&&(!crossRoute||all.ready)&&
  (!needRoute||!route.loading)&&(!crossRoute||!all.loading);
 const error=[needRoute?route.error:'',crossRoute?all.error:''].filter(Boolean).join(' · ');
 // Retain .line and .items for the timer's immediate route snapshot on selection.
 const lookup={line:lookupLine,items,error,loading:!lookupReady};
 return {lookup,lookupLine,lookupOrder,queryKind:search.kind,queryVehicle:search.kind==='vehicle'?search.vehicle:'',
  results:available,lookupReady,stopNames};
}
