import {IndexedPidStore} from './pidPersistentCache.ts';
import type {PidStore,PidCacheInfo} from './pidPersistentCache.ts';
import {PidStaticEngine,PidStaticError,formatGtfsSeconds,pidServiceDate} from './pidStatic.ts';
import type {PidManifest} from './pidStatic.ts';

export type Phase2Scenario='load'|'restart'|'offline'|'version'|'midnight';
export type Phase2Result={
 id:Phase2Scenario;title:string;status:'pass'|'fail';mode:'real'|'simulation';
 description:string;durationMs:number;requests:number;jsonBytes:number;
 detail:string;error?:string;date:string;tripId:string;at:string;
};
export type Phase2DiagnosticConfig={base?:string;store?:PidStore;fetcher?:typeof fetch};
const baseDefault=()=>{
 const prefix=typeof import.meta.env?.BASE_URL==='string'?import.meta.env.BASE_URL:'/';
 return (prefix.endsWith('/')?prefix:prefix+'/')+'data/pid/v1/';
};
export const phase2Scenarios:{id:Phase2Scenario;title:string;description:string;mode:'real'|'simulation'}[]=[
 {id:'load',title:'1. První načtení',description:'Načte jízdní řád a ověří zápis segmentů do IndexedDB.',mode:'real'},
 {id:'restart',title:'2. Nová instance klienta',description:'Bez obnovy stránky vytvoří nový Static Engine a ověří, že již uložené segmenty nevyžadují další HTTP.',mode:'real'},
 {id:'offline',title:'3. Výpadek sítě',description:'V nové instanci úmyslně zablokuje fetch a ověří čtení uloženého jízdního řádu.',mode:'simulation'},
 {id:'version',title:'4. Změna datové verze',description:'Simuluje nesoulad kontrolního součtu nové verze a vyžaduje jeho odmítnutí.',mode:'simulation'},
 {id:'midnight',title:'5. Přechod přes půlnoc',description:'Ověří pražské provozní datum a čas 25:10, bez změny systémových hodin.',mode:'simulation'}
];

const utf8Bytes=(value:string)=>new TextEncoder().encode(value).byteLength;

function monitoredFetch(delegate:typeof fetch){
 const counters={requests:0,jsonBytes:0,manifest:0,shards:0};
 const loader:typeof fetch=async(input,init)=>{
  const result=await delegate(input,init);
  counters.requests++;
  if(String(input).endsWith('/manifest.json'))counters.manifest++;
  else counters.shards++;
  if(result.ok){
   try{counters.jsonBytes+=utf8Bytes(await result.clone().text());}catch{/* no bytes estimate */}
  }
  return result;
 };
 return {loader,counters};
}
function check(valid:unknown,message:string):asserts valid{
 if(!valid)throw new Error(message);
}
function errorText(error:unknown){
 return error instanceof Error?error.message:String(error);
}
export async function runPhase2Scenario(id:Phase2Scenario,date:string,tripId:string,
 options:Phase2DiagnosticConfig={}):Promise<Phase2Result>{
 const item=phase2Scenarios.find(s=>s.id===id);
 if(!item)throw new Error('Unknown PID test scenario');
 const store=options.store??new IndexedPidStore();
 const base=options.base??baseDefault();
 const fetcher=options.fetcher??((input:RequestInfo|URL,init?:RequestInit)=>globalThis.fetch(input,init));
 const monitored=monitoredFetch(fetcher);
 const started=performance.now();
 let detail='';
 let status:'pass'|'fail'='pass';
 let failure='';
 try{
  if(id==='load'){
   check(!!tripId,'Zadej konkrétní GTFS trip_id.');
   const engine=new PidStaticEngine(base,monitored.loader,store);
   const stops=await engine.getTripStops(tripId,date);
   check(stops?.length,'Trip není pro vybraný provozní den dostupný.');
   const manifest=await engine.getManifest();
   const cache=await store.get(manifest.generatedAt+'|days/'+date+'/trips.json');
   check(cache,'Index tripů nebyl uložen do IndexedDB.');
   detail='Zastávek: '+stops.length+'; verze: '+manifest.generatedAt+
    '; zdroj manifestu: '+engine.getDataStatus().source+'.';
  }else if(id==='restart'||id==='offline'){
   check(!!tripId,'Zadej GTFS trip_id.');
   // Warm-up is explicitly part of this test; reload uses a new engine instance.
   const warm=new PidStaticEngine(base,fetcher,store);
   const before=await warm.getTripStops(tripId,date);
   check(before?.length,'Nejdřív je nutné úspěšně načíst trip ze sítě.');
   if(id==='restart'){
    const fresh=new PidStaticEngine(base,monitored.loader,store);
    const after=await fresh.getTripStops(tripId,date);
    check(after?.length===before.length,'Znovunačtený jízdní řád se liší.');
    check(monitored.counters.shards===0,
     'Při nové instanci se znovu stahovaly již uložené segmenty.');
    detail='Nová instance; '+after.length+' zastávek; HTTP segmentů: 0'+
     '; kontrola manifestu: '+monitored.counters.manifest+'.';
   }else{
    let attempted=0;
    const noNetwork:typeof fetch=async()=>{
     attempted++;throw new TypeError('Simulovaný výpadek sítě');
    };
    const fresh=new PidStaticEngine(base,noNetwork,store);
    const after=await fresh.getTripStops(tripId,date);
    check(after?.length===before.length,'Offline trip nelze obnovit z uložených segmentů.');
    check(fresh.getDataStatus().source==='persisted','Manifest nebyl načten z lokální cache.');
    detail='Vynucené selhání '+attempted+' síťového požadavku; '+
     after.length+' zastávek obnoveno z IndexedDB, zdroj manifestu: persisted.';
   }
  }else if(id==='version'){
   // No real files or cache are changed. A fresh version and a mismatched
   // routes.json body must fail verification before it enters the cache.
   const published=new PidStaticEngine(base,fetcher,store);
   const source=await published.getManifest();
   const fake={...source,generatedAt:'simulated-invalid-'+Date.now(),
    checksums:{'routes.json':'0'.repeat(64)}} satisfies PidManifest;
   const synthetic:typeof fetch=async(input)=>{
    if(String(input).includes('manifest.json'))
     return new Response(JSON.stringify(fake),{status:200,headers:{'Content-Type':'application/json'}});
    return new Response('{"TEST":["wrong-shard"]}',{status:200,
     headers:{'Content-Type':'application/json'}});
   };
   const temporaryStore:PidStore={get:async()=>null,put:async()=>{},clear:async()=>{}};
   const engine=new PidStaticEngine(base,synthetic,temporaryStore);
   let mismatch=false;
   try{await engine.getRoutes();}
   catch(error){mismatch=error instanceof PidStaticError&&error.reason==='invalid'&&
    /mismatch/.test(error.message);}
   check(mismatch,'Neplatný SHA-256 otisk nebyl odmítnut.');
   detail='Simulovaná jiná verze a chybný SHA-256: bezpečně odmítnuto. '+ 
    'Publikovaná data a IndexedDB zůstaly beze změny.';
  }else{
   const before=pidServiceDate(new Date('2026-11-08T22:50:00Z'));
   const after=pidServiceDate(new Date('2026-11-08T23:10:00Z'));
   check(before==='2026-11-08'&&after==='2026-11-09',
    'Pražské datum se při půlnoci nezměnilo správně.');
   check(formatGtfsSeconds(25*3600+10*60)==='25:10:00',
    'Čas GTFS nad 24:00 byl normalizován nesprávně.');
   const manifest=await new PidStaticEngine(base,monitored.loader,store).getManifest();
   const available=Object.entries(manifest.days)
    .filter(([,info])=>info.available).map(([serviceDay])=>serviceDay);
   check(available.length>0,'Manifest neobsahuje žádný dostupný provozní den.');
   detail='8. 11. 23:50 → 9. 11. 00:10 (Praha): PASS; '+
    'GTFS 25:10:00 zachováno; manifest obsahuje dny: '+available.join(', ')+'.';
  }
 }catch(error){
  status='fail';failure=errorText(error);
  detail='Test nesplnil požadované podmínky.';
 }
 return {
  id,title:item.title,status,mode:item.mode,description:item.description,
  durationMs:Math.round(performance.now()-started),
  requests:monitored.counters.requests,jsonBytes:monitored.counters.jsonBytes,
  detail,error:failure||undefined,date,tripId,at:new Date().toISOString()
 };
}

export async function phase2CacheInfo():Promise<PidCacheInfo>{
 return new IndexedPidStore().inspect();
}
export async function clearPhase2Cache():Promise<void>{
 const store=new IndexedPidStore();
 await store.clear();
}
