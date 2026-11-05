import {useEffect,useState} from 'react';

/** Only static, public PID GTFS data. No per-vehicle Golemio lookup. */
export type ChooserTarget={
 tripId:string;nextId:string;nextSequence:number|null;
 fallbackTripId:string;directName:string;atTerminal:boolean;
};
type Names=Record<string,string>;
type Lookup={stops:Names;first:Names};
const empty:Lookup={stops:{},first:{}};
let cached:Lookup|null=null;
let pending:Promise<Lookup>|null=null;
const url=(name:string)=>import.meta.env.BASE_URL+'data/'+name;
async function readMap(name:string):Promise<Names>{
 const response=await fetch(url(name),{cache:'default'});
 if(!response.ok)throw new Error('PID GTFS lookup: '+response.status);
 const body:unknown=await response.json();
 if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('PID GTFS: invalid lookup');
 return body as Names;
}
function loadLookup():Promise<Lookup>{
 if(cached)return Promise.resolve(cached);
 if(pending)return pending;
 pending=Promise.all([readMap('stops.json'),readMap('tram-trip-first-stops.json')])
  .then(([stops,first])=>{
   if(Object.keys(stops).length<100||Object.keys(first).length<100)throw Error('PID GTFS: incomplete data');
   cached={stops,first};
   return cached;
  }).finally(()=>{pending=null;});
 return pending;
}
// Keeping the hook's argument signature makes the replacement local to this
// module. The trip IDs and API token no longer cause any network activity.
export function useChooserStops(_targets:ChooserTarget[],_token:string,enabled:boolean):Lookup{
 const [data,setData]=useState<Lookup>(()=>cached??empty);
 useEffect(()=>{
  if(!enabled)return;
  let alive=true;
  void loadLookup().then(value=>{if(alive)setData(value);}).catch(()=>{
   // The vehicle list stays usable even if a static GTFS refresh is unavailable.
  });
  return()=>{alive=false;};
 },[enabled]);
 return data;
}
const good=(name:unknown):name is string=>
 typeof name==='string'&&name.trim()!==''&&name!=='—'&&name!=='Neznámá zastávka';
export function chooserStop(target:ChooserTarget,known:Lookup):string{
 const byId=(id:string)=>id?known.stops[id]:'';
 const first=(id:string)=>id?byId(known.first[id]??''):'';
 if(target.atTerminal){
  const terminal=first(target.fallbackTripId)||first(target.tripId);
  if(good(terminal))return terminal;
 }
 const next=byId(target.nextId);
 for(const name of [next,target.directName]){
  if(good(name))return name;
 }
 // If a future trip is known, its first stop is a terminal fallback only.
 return '—';
}
