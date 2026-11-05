/**
 * Browser-side Golemio coordinator. Interactive vehicle lists and the running
 * timer are high priority. Optional GTFS stop-name decoration is low priority.
 */
type Entry={value:unknown;at:number};
type Job={key:string;url:string;token:string;ttlMs:number;priority:number;resolve:(value:unknown)=>void;reject:(reason:unknown)=>void};
const cache=new Map<string,Entry>();
const inFlight=new Map<string,Promise<unknown>>();
const queue:Job[]=[];
let running=false;
let nextRequestAt=0;
let cooldownUntil=0;
const SPACING_MS=900;
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export class GolemioLimitError extends Error{
 constructor(public readonly waitSeconds:number){
  super('Golemio dočasně omezilo požadavky. Další pokus přibližně za '+waitSeconds+' s.');
  this.name='GolemioLimitError';
 }
}
function retryAfter(response:Response):number{
 const after=response.headers.get('Retry-After');
 const seconds=after&&/^\d+$/.test(after)?Number(after):NaN;
 const date=after&&!Number.isFinite(seconds)?Date.parse(after):NaN;
 return Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-Date.now():90000;
}
async function drain(){
 if(running)return;
 running=true;
 try{
  while(queue.length){
   // Select priority at execution time, not submission time.
   queue.sort((a,b)=>a.priority-b.priority);
   const job=queue.shift()!;
   const old=cache.get(job.key);
   if(old&&Date.now()-old.at<job.ttlMs){job.resolve(old.value);continue;}
   if(Date.now()<cooldownUntil){
    job.reject(new GolemioLimitError(Math.ceil((cooldownUntil-Date.now())/1000)));continue;
   }
   await sleep(Math.max(0,nextRequestAt-Date.now()));
   if(Date.now()<cooldownUntil){
    job.reject(new GolemioLimitError(Math.ceil((cooldownUntil-Date.now())/1000)));continue;
   }
   nextRequestAt=Date.now()+SPACING_MS;
   try{
    const response=await fetch(job.url,{headers:{'X-Access-Token':job.token},cache:'no-store'});
    if(response.status===429){
     cooldownUntil=Date.now()+Math.max(30000,Math.min(300000,retryAfter(response)));
     throw new GolemioLimitError(Math.ceil((cooldownUntil-Date.now())/1000));
    }
    if(!response.ok)throw Error('Golemio HTTP '+response.status);
    const value:unknown=await response.json();
    cache.set(job.key,{value,at:Date.now()});
    if(cache.size>160){
     const oldest=[...cache.entries()].sort((a,b)=>a[1].at-b[1].at).slice(0,40);
     for(const [key] of oldest)cache.delete(key);
    }
    job.resolve(value);
   }catch(e){job.reject(e);}
  }
 }finally{running=false;if(queue.length)void drain();}
}
export function golemioJson<T>(url:string,token:string,ttlMs:number,priority:'high'|'low'='high'):Promise<T>{
 const key=token+'|'+url;
 const old=cache.get(key);
 if(old&&Date.now()-old.at<ttlMs)return Promise.resolve(old.value as T);
 const existing=inFlight.get(key);
 if(existing)return existing as Promise<T>;
 // If the server has already asked us to pause, reject immediately rather
 // than showing a spinner for a request that cannot yet be executed.
 if(Date.now()<cooldownUntil)return Promise.reject(new GolemioLimitError(Math.ceil((cooldownUntil-Date.now())/1000)));
 const promise=new Promise<unknown>((resolve,reject)=>{
  queue.push({key,url,token,ttlMs,priority:priority==='high'?0:1,resolve,reject});
  void drain();
 }).finally(()=>inFlight.delete(key));
 inFlight.set(key,promise);
 return promise as Promise<T>;
}
export function golemioCooldownSeconds(){return Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000));}
