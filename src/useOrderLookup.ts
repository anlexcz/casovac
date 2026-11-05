import {useEffect,useState} from 'react';
import {selectTrip,stateOf} from './tripSelection';
import {useChooserStops} from './chooserStops';
import type {ChooserTarget} from './chooserStops';
import {golemioJson} from './golemioClient';
import {path,orderOf,normalize,vehicleId,selectedTripId} from './featureUtils';
import type {Feature,Obj} from './featureUtils';

const API='https://api.golemio.cz/v2/vehiclepositions';
export function useOrderLookup(query:string,editing:boolean,token:string,now:number){
 const [lookup,setLookup]=useState<{line:string;items:Feature[];error:string;loading:boolean}>({line:'',items:[],error:'',loading:false});
 const lookupLine=/^\d{1,3}(?:\s*\/\s*\d{0,4})?$/.test(query.trim())?query.trim().split('/')[0].trim():'';
 useEffect(()=>{
  if(!editing||!lookupLine||!token.trim())return;
  let alive=true;const abort=new AbortController();
  async function load(){
   setLookup(previous=>({line:lookupLine,items:previous.line===lookupLine?previous.items:[],error:'',loading:true}));
   try{
    const url=new URL(API);url.searchParams.set('routeShortName',lookupLine);
    url.searchParams.set('includeNotTracking','true');url.searchParams.set('limit','1000');
    const body:unknown=await golemioJson<unknown>(url.toString(),token.trim(),20000);
    if(!body||typeof body!=='object'||!Array.isArray((body as Obj).features))throw Error('Neplatná odpověď');
    if(alive)setLookup({line:lookupLine,items:(body as {features:Feature[]}).features,error:'',loading:false});
   }catch(e){if(alive&&!abort.signal.aborted)setLookup(previous=>({
    line:lookupLine,items:previous.line===lookupLine?previous.items:[],
    error:e instanceof Error?e.message:String(e),loading:false
   }));}
  }
  const delay=setTimeout(()=>void load(),250),interval=setInterval(()=>void load(),45000);
  return()=>{alive=false;abort.abort();clearTimeout(delay);clearInterval(interval);};
 },[editing,lookupLine,token]);
 const available=new Map<string,{line:string;order:string;car:string;target:ChooserTarget}>();
 if(lookup.line===lookupLine){
  const groups=new Map<string,Feature[]>();
  for(const f of lookup.items){
   const line=String(path(f,'properties.trip.gtfs.route_short_name')??path(f,'properties.trip.route_short_name')??'');
   const raw=orderOf(f);
   if(normalize(line)!==normalize(lookupLine)||raw===null||raw===undefined||!/^\d+$/.test(String(raw)))continue;
   const key=normalize(line)+'/'+normalize(raw);
   groups.set(key,[...(groups.get(key)??[]),f]);
  }
  for(const [key,items] of groups){
   const [line,order]=key.split('/');
   const chosen=selectTrip(items,line,order,now).feature??items[0];
   const car=vehicleId(chosen);
   const state=stateOf(chosen);
   const next=path(chosen,'properties.last_position.next_stop');
   const last=path(chosen,'properties.last_position.last_stop');
   const nextObj=next&&typeof next==='object'?next as Obj:null;
   const nextId=String(nextObj?.id??(typeof next==='string'?next:''));
   const seq=nextObj?.sequence;
   const future=items.filter(f=>vehicleId(f)===car&&stateOf(f).startsWith('before_track'))
    .sort((a,b)=>Number(path(a,'properties.trip.start_timestamp')??0)-Number(path(b,'properties.trip.start_timestamp')??0))[0];
   const atTerminal=state.startsWith('after_track')||state.startsWith('before_track')||(!next&&!!future);
   const rawName=nextObj?.name??(last&&typeof last==='object'?(last as Obj).name:undefined);
   const target:ChooserTarget={
    tripId:selectedTripId(chosen),fallbackTripId:future?selectedTripId(future):'',
    nextId,nextSequence:seq!==undefined&&seq!==null&&Number.isFinite(Number(seq))?Number(seq):null,
    directName:typeof rawName==='string'?rawName:'',atTerminal
   };
   available.set(key,{line,order,car,target});
  }
 }
 const stopNames=useChooserStops([...available.values()].map(v=>v.target),token.trim(),editing&&!!lookupLine);
 const match=/^(\d{1,3})\s*\/\s*(\d{1,4})$/.exec(query.trim());
 const lookupOrder:[string,string]|null=match?[match[1],match[2]]:null;
 const results=[...available.values()].filter(item=>!lookupOrder||normalize(item.order)===normalize(lookupOrder[1])).sort((a,b)=>Number(a.order)-Number(b.order));
 const lookupReady=lookup.line===lookupLine&&!lookup.loading;
 return {lookup,lookupLine,lookupOrder,results,lookupReady,stopNames};
}
