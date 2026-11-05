import {useEffect,useState} from 'react';
import {parseStops} from './tripData';
import type {Stop} from './tripData';

export type ChooserTarget={tripId:string;nextId:string;nextSequence:number|null;fallbackTripId:string;directName:string;atTerminal:boolean};
const cache=new Map<string,Stop[]>();
const pending=new Map<string,Promise<Stop[]>>();
const good=(v:string)=>!!v&&v!=='—'&&v!=='Neznámá zastávka';
async function getStops(id:string,token:string,signal?:AbortSignal):Promise<Stop[]>{
 if(cache.has(id))return cache.get(id)!;
 const existing=pending.get(id);
 if(existing)return existing;
 const promise=(async()=>{
  const headers={'X-Access-Token':token};
  const url=new URL('https://api.golemio.cz/v2/public/gtfs/trips/'+encodeURIComponent(id));
  url.searchParams.append('scopes[]','info');url.searchParams.append('scopes[]','stop_times');
  const response=await fetch(url,{headers,cache:'no-store',signal});
  if(!response.ok)throw Error('GTFS trip HTTP '+response.status);
  const body:unknown=await response.json();
  let stops=parseStops(body);
  if(!stops.length){
   const fallback=await fetch('https://api.golemio.cz/v2/gtfs/stoptimes/'+encodeURIComponent(id),{headers,cache:'no-store',signal});
   if(fallback.ok)stops=parseStops(await fallback.json());
  }
  if(stops.some(s=>good(s.name)))cache.set(id,stops);
  return stops;
 })().finally(()=>pending.delete(id));
 pending.set(id,promise);
 return promise;
}
export function useChooserStops(targets:ChooserTarget[],token:string,enabled:boolean):Record<string,Stop[]>{
 const [revision,setRevision]=useState(0);
 const keys=[...new Set(targets.flatMap(t=>[t.tripId,t.fallbackTripId]).filter(id=>id&&id!=='—'))];
 const key=keys.slice().sort().join('|');
 useEffect(()=>{
  if(!enabled||!token||!keys.length)return;
  let alive=true;
  const controller=new AbortController();
  const ids=keys.filter(id=>!cache.has(id));
  const run=async()=>{
   let position=0;
   const workers=Array.from({length:Math.min(4,ids.length)},async()=>{
    while(position<ids.length&&alive){
     const id=ids[position++];
     try{await getStops(id,token,controller.signal);}catch{/* Names are optional. Do not block the chooser. */}
     if(alive)setRevision(v=>v+1);
    }
   });
   await Promise.all(workers);
  };
  void run();
  return()=>{alive=false;controller.abort();};
  // Target trip IDs, not telemetry changes, control lookup work.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,token,enabled]);
 void revision;
 return Object.fromEntries(keys.map(id=>[id,cache.get(id)??[]]));
}
export function chooserStop(target:ChooserTarget,known:Record<string,Stop[]>):string{
 const current=known[target.tripId]??[];
 const next=target.nextSequence!==null?current.find(s=>s.sequence===target.nextSequence):undefined;
 const byId=target.nextId?current.find(s=>s.id===target.nextId):undefined;
 if(!target.atTerminal){
  for(const name of [target.directName,next?.name,byId?.name])if(name&&good(name))return name;
 }
 const future=known[target.fallbackTripId]??[];
 const first=future.find(s=>good(s.name));
 if(first)return first.name;
 if(target.atTerminal){
  const firstCurrent=current.find(s=>good(s.name));
  if(firstCurrent)return firstCurrent.name;
 }
 for(const name of [target.directName,next?.name,byId?.name])if(name&&good(name))return name;
 return '—';
}
