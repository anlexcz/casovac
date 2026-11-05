/**
 * Shared browser-side Golemio request coordinator.
 * Prevents the vehicle poller, chooser and GTFS lookups from racing the API.
 */
type Entry={value:unknown;at:number};
const cache=new Map<string,Entry>();
const inFlight=new Map<string,Promise<unknown>>();
let nextRequestAt=0;
let cooldownUntil=0;
let tail:Promise<void>=Promise.resolve();
const SPACING_MS=1500;
function sleep(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));}
export class GolemioLimitError extends Error{
 constructor(public readonly waitSeconds:number){
  super('Golemio dočasně omezilo požadavky. Další pokus přibližně za '+waitSeconds+' s.');
  this.name='GolemioLimitError';
 }
}
export async function golemioJson<T>(url:string,token:string,ttlMs:number):Promise<T>{
 const key=token+'|'+url;
 const entry=cache.get(key);
 if(entry&&Date.now()-entry.at<ttlMs)return entry.value as T;
 const existing=inFlight.get(key);
 if(existing)return existing as Promise<T>;
 const perform=async():Promise<T>=>{
  // Keep the queue alive after failed requests.
  const previous=tail;
  let release=()=>{};
  tail=new Promise<void>(resolve=>{release=resolve;});
  await previous;
  try{
   const now=Date.now();
   if(now<cooldownUntil)throw new GolemioLimitError(Math.ceil((cooldownUntil-now)/1000));
   await sleep(Math.max(0,nextRequestAt-Date.now()));
   if(Date.now()<cooldownUntil)throw new GolemioLimitError(Math.ceil((cooldownUntil-Date.now())/1000));
   nextRequestAt=Date.now()+SPACING_MS;
   const response=await fetch(url,{headers:{'X-Access-Token':token},cache:'no-store'});
   if(response.status===429){
    const after=response.headers.get('Retry-After');
    const seconds=after&&/^\d+$/.test(after)?Number(after):NaN;
    const date=after&&!Number.isFinite(seconds)?Date.parse(after):NaN;
    const duration=Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-Date.now():90000;
    cooldownUntil=Date.now()+Math.max(30000,Math.min(300000,duration));
    throw new GolemioLimitError(Math.ceil((cooldownUntil-Date.now())/1000));
   }
   if(!response.ok)throw Error('Golemio HTTP '+response.status);
   const value:unknown=await response.json();
   cache.set(key,{value,at:Date.now()});
   if(cache.size>160){
    const oldest=[...cache.entries()].sort((a,b)=>a[1].at-b[1].at).slice(0,40);
    for(const [id] of oldest)cache.delete(id);
   }
   return value as T;
  }finally{release();}
 };
 const promise=perform().finally(()=>inFlight.delete(key));
 inFlight.set(key,promise);
 return promise;
}
export function golemioCooldownSeconds():number{
 return Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000));
}
