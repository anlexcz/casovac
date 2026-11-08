import {useMemo,useState} from 'react';
import {golemioJson} from './golemioClient';
import {stored,TOKEN_KEY} from './trackingStorage';
import {parseOrder} from './useAppController';
import {selectTrip,tripIdOf} from './tripSelection';
import {orderOf,routeOf} from './featureUtils';
import type {Feature,Obj} from './featureUtils';
import {parseStops} from './tripData';
import {pidStatic,comparePidTripStops,pidTripStopRows} from './pidStatic.ts';

type Probe={
 id:string;title:string;url:string;receivedAt:string;elapsedMs:number;
 ok:boolean;data?:unknown;error?:string;
};
const API='https://api.golemio.cz/v2';
const related:Record<string,string>={'5':'6','6':'5','9':'10','10':'9'};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const stringify=(value:unknown)=>JSON.stringify(value,null,2);
function blocks(value:unknown){
 const found:Array<{where:string;value:unknown}>=[];
 const walk=(v:unknown,location:string,depth:number)=>{
  if(found.length>=60||depth>9||v===null||typeof v!=='object')return;
  if(Array.isArray(v)){v.forEach((entry,i)=>walk(entry,location+'['+i+']',depth+1));return;}
  for(const [key,entry] of Object.entries(v as Obj)){
   if(/block[_-]?id|blockid/i.test(key))found.push({where:location+'.'+key,value:entry});
   if(typeof entry==='object'&&entry!==null)walk(entry,location+'.'+key,depth+1);
  }
 };
 walk(value,'$',0);
 return found;
}
function scanTrips(data:unknown,line:string,order:string):Feature[]{
 const obj=data as {features?:unknown}|null;
 if(!obj||!Array.isArray(obj.features))return [];
 return (obj.features as Feature[]).filter(f=>routeOf(f)===line&&String(orderOf(f)??'').replace(/^0+/,'')===order.replace(/^0+/,''));
}
function getStopIds(value:unknown):string[]{
 return [...new Set(parseStops(value).map(s=>s.id).filter(Boolean))];
}
function jsonExport(filename:string,body:unknown){
 const blob=new Blob([stringify(body)],{type:'application/json;charset=utf-8'});
 const href=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=href;a.download=filename;a.click();
 window.setTimeout(()=>URL.revokeObjectURL(href),1500);
}
export default function RawDebug(){
 const [token,setToken]=useState(()=>stored(TOKEN_KEY));
 const [query,setQuery]=useState('10/21');
 const [date,setDate]=useState(today);
 const [manualTrip,setManualTrip]=useState('');
 const [stopId,setStopId]=useState('');
 const [results,setResults]=useState<Probe[]>([]);
 const [staticCheck,setStaticCheck]=useState<unknown|null>(null);
 const [staticBusy,setStaticBusy]=useState(false);
 const [loading,setLoading]=useState(false);
 const [message,setMessage]=useState('');
 const [selected,setSelected]=useState<{tripId:string;vehicle:string;reason:string;ambiguous:boolean;matched:number}|null>(null);
 const ready=!!token.trim()&&!loading;
 const discovered=useMemo(()=>results.flatMap(item=>item.ok?blocks(item.data).map(b=>({...b,source:item.title})):[]),[results]);
 const read=async(id:string,title:string,url:string):Promise<Probe>=>{
  const started=Date.now();
  try{
   const data=await golemioJson<unknown>(url,token.trim(),0,'low');
   return {id,title,url,receivedAt:new Date().toISOString(),elapsedMs:Date.now()-started,ok:true,data};
  }catch(e){
   return {id,title,url,receivedAt:new Date().toISOString(),elapsedMs:Date.now()-started,ok:false,
    error:e instanceof Error?e.message:String(e)};
  }
 };
 async function examine(){
  const current=parseOrder(query);
  if(!ready||!current){setMessage('Zadej platné pořadí ve tvaru 10/21 a API klíč.');return;}
  setLoading(true);setMessage('');setSelected(null);setResults([]);setStaticCheck(null);
  const [line,order]=current;
  const outputs:Probe[]=[];
  const append=(probe:Probe)=>{outputs.push(probe);setResults([...outputs]);};
  try{
   const primaryUrl=new URL(API+'/vehiclepositions');
   primaryUrl.searchParams.set('routeShortName',line);
   primaryUrl.searchParams.set('includeNotTracking','true');
   primaryUrl.searchParams.set('limit','1000');
   const primary=await read('primary','Vehiclepositions · linka '+line,primaryUrl.toString());
   append(primary);
   if(primary.ok){
    const all=(primary.data as {features?:Feature[]}|null)?.features??[];
    const choice=selectTrip(Array.isArray(all)?all:[],line,order,Date.now());
    const own=scanTrips(primary.data,line,order);
    const tripId=manualTrip.trim()||(choice.feature?tripIdOf(choice.feature):'');
    setSelected({
     tripId:tripId||'',vehicle:choice.vehicle??'',reason:choice.reason,
     ambiguous:choice.ambiguous,matched:own.length
    });
    const counterpart=related[line];
    if(counterpart){
     const pairedUrl=new URL(API+'/vehiclepositions');
     pairedUrl.searchParams.set('routeShortName',counterpart);
     pairedUrl.searchParams.set('includeNotTracking','true');
     pairedUrl.searchParams.set('limit','1000');
     append(await read('paired','Vehiclepositions · možná návazná linka '+counterpart,pairedUrl.toString()));
    }
    if(tripId){
     const detailUrl=new URL(API+'/gtfs/trips/'+encodeURIComponent(tripId));
     detailUrl.searchParams.set('date',date);
     for(const field of ['includeStopTimes','includeStops','includeService','includeRoute'])
      detailUrl.searchParams.set(field,'true');
     const detail=await read('detail','GTFS Static · detail tripu',detailUrl.toString());
     append(detail);
     if(detail.ok){
      const ids=getStopIds(detail.data);
      if(ids.length)setStopId(current=>current||ids[ids.length-1]);
     }
     // Compare the endpoint already used by Časovač with the full GTFS Static endpoint.
     const lookupUrl=new URL(API+'/public/gtfs/trips/'+encodeURIComponent(tripId));
     for(const scope of ['info','stop_times','shapes'])lookupUrl.searchParams.append('scopes[]',scope);
     append(await read('lookup','Public GTFS Lookup · detail používaný Časovačem',lookupUrl.toString()));
    }else{
     setMessage('Aktuální trip se nepodařilo jednoznačně určit. Prohlédni si syrové vehiclepositions nebo vyplň trip_id ručně.');
    }
   }else{
    setMessage('Živé polohy se nepodařilo načíst. Zkontroluj API klíč a stav Golemia.');
   }
  }finally{setLoading(false);}
 }
 async function fetchTrip(){
  if(!ready||!manualTrip.trim()){setMessage('Pro ruční načtení zadej trip_id.');return;}
  setLoading(true);setMessage('');
  try{
   const url=new URL(API+'/gtfs/trips/'+encodeURIComponent(manualTrip.trim()));
   url.searchParams.set('date',date);
   for(const field of ['includeStopTimes','includeStops','includeService','includeRoute'])
    url.searchParams.set(field,'true');
   const result=await read('manual-'+Date.now(),'GTFS Static · ručně zadaný trip',url.toString());
   setResults(current=>[...current,result]);
  }finally{setLoading(false);}
 }
 async function fetchNearby(){
  if(!ready||!stopId.trim()){setMessage('Nejdříve zadej stop_id přechodové zastávky.');return;}
  setLoading(true);setMessage('');
  try{
   const url=new URL(API+'/gtfs/trips');
   url.searchParams.set('date',date);url.searchParams.set('stopId',stopId.trim());
   url.searchParams.set('limit','200');url.searchParams.set('offset','0');
   const result=await read('nearby-'+Date.now(),'GTFS Static · tripy pro stop_id '+stopId.trim(),url.toString());
   setResults(current=>[...current,result]);
  }finally{setLoading(false);}
 }
 async function compareStatic(){
  const id=manualTrip.trim()||selected?.tripId||'';
  if(!id){setStaticCheck({error:'Nejdříve načti trip nebo zadej jeho GTFS trip_id.'});return;}
  setStaticBusy(true);
  try{
   const manifest=await pidStatic.getManifest(true);
   const trip=await pidStatic.getTrip(id,date);
   if(!trip){setStaticCheck({id,date,manifest:manifest.generatedAt,error:'Trip není v daném provozním dni v offline balíku.'});return;}
   const local=pidTripStopRows(trip,await pidStatic.getGtfsStops());
   const remote=results.find(item=>item.ok&&item.id==='lookup')??
    results.find(item=>item.ok&&item.id==='detail');
   const verified=remote?parseStops(remote.data):[];
   setStaticCheck({
    tripId:id,date,routeId:trip.routeId,blockId:trip.blockId,
    manifestDate:manifest.referenceDay,manifestGeneratedAt:manifest.generatedAt,
    staticStops:local.length,staticFirstStop:local[0]?.id,staticLastStop:local.at(-1)?.id,
    comparisonSource:remote?.title??'Zatím bez online detailu',
    ...(verified.length?comparePidTripStops(local,verified):{compared:false,message:'Online detail není k dispozici – offline jízdní řád byl načten, ale nelze jej porovnat.'})
   });
  }catch(e){
   setStaticCheck({error:e instanceof Error?e.message:String(e)});
  }finally{setStaticBusy(false);}
 }
 const exportAll=()=>jsonExport('casovac-rawdebug-'+date+'.json',{
  exportedAt:new Date().toISOString(),query,date,selected,results,
  note:'API klíč se neexportuje. Výpis může obsahovat veřejné polohy vozidel.'
 });
 return <main className="rawPage">
  <header className="topbar"><h1>RAWDEBUG<span className="dot">.</span></h1><a className="rawBack" href={import.meta.env.BASE_URL}>← Časovač</a></header>
  <p className="hint">Diagnostika živých odpovědí Golemia a online GTFS. Nic neimportuje ani denně nestahuje. Požadavky se odesílají pouze po stisknutí tlačítka.</p>
  <section className="panel rawSettings">
   <div className="rawField"><label htmlFor="rawOrder">LINKA / POŘADÍ</label><input id="rawOrder" value={query} onChange={e=>setQuery(e.target.value)} placeholder="10/21"/></div>
   <div className="rawField"><label htmlFor="rawDate">PROVOZNÍ DEN</label><input id="rawDate" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
   <div className="rawField rawToken"><label htmlFor="rawToken">GOLEMIO API KLÍČ</label><input id="rawToken" type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" placeholder="Použije se uložený klíč Časovače, pokud existuje"/></div>
   <button className="primary" disabled={!ready} onClick={()=>void examine()}>{loading?'Načítám…':'Načíst online data'}</button>
   <p className="hint">Klíč se nepřidává do URL, záznamů ani exportu; pokud ho vyplníš zde, automaticky se neukládá. API dotazy mohou být omezeny limity Golemia.</p>
  </section>
  {message&&<div className="alert" role="status">{message}</div>}
  {selected&&<section className="panel">
   <h2>Identifikace sledovaného spoje</h2>
   <div className="rawFacts">
    <div><small>TRIP ID</small><strong>{selected.tripId||'Neznámý'}</strong></div>
    <div><small>VŮZ</small><strong>{selected.vehicle?'#'+selected.vehicle:'Neznámý'}</strong></div>
    <div><small>POČET ZÁZNAMŮ POŘADÍ</small><strong>{selected.matched}</strong></div>
    <div><small>NEJEDNOZNAČNOST</small><strong>{selected.ambiguous?'Ano':'Ne'}</strong></div>
   </div><p className="hint">{selected.reason}</p>
  </section>}
  <section className="panel rawExtra">
   <h2>Doplňující online dotazy</h2>
   <p className="hint">Pokud Golemio nevrátí trip automaticky, můžeš zadat konkrétní ID. Vyhledávání tripů přes zastávku je omezené na prvních 200 výsledků; není to vyhledávání podle block_id.</p>
   <div className="rawField"><label htmlFor="rawTrip">TRIP_ID</label><input id="rawTrip" value={manualTrip} onChange={e=>setManualTrip(e.target.value)} placeholder="Trip ID z odpovědi API"/></div>
   <button className="quiet" disabled={!ready||!manualTrip.trim()} onClick={()=>void fetchTrip()}>Načíst detail tripu</button>
   <div className="rawField"><label htmlFor="rawStop">STOP_ID</label><input id="rawStop" value={stopId} onChange={e=>setStopId(e.target.value)} placeholder="ID konečné zastávky"/></div>
   <button className="quiet" disabled={!ready||!stopId.trim()} onClick={()=>void fetchNearby()}>Načíst okolní tripy</button>
   <h3>Porovnání s offline PID (fáze 1B)</h3>
   <p className="hint">Ruční kontrola proti datovému balíku Časovače. Neovlivňuje sledování ani provozní dotazy; nespouští se automaticky.</p>
   <button className="quiet" disabled={staticBusy||!(manualTrip.trim()||selected?.tripId)}
    onClick={()=>void compareStatic()}>{staticBusy?'Porovnávám…':'Porovnat online detail s offline GTFS'}</button>
   {staticCheck!==null&&<pre className="rawJson">{stringify(staticCheck)}</pre>}
  </section>
  <section className="panel">
   <div className="rawSectionHead"><h2>Výskyty block_id v odpovědích</h2><strong>{discovered.length}</strong></div>
   {discovered.length?discovered.map((item,i)=><div key={i} className="rawBlockField">
    <small>{item.source} · {item.where}</small><code>{stringify(item.value)}</code>
   </div>):<p className="hint">Zatím nebyl nalezen žádný klíč typu block_id. To neznamená, že vazba v GTFS neexistuje; jen ji nemusí daný endpoint vracet.</p>}
  </section>
  <section className="panel">
   <div className="rawSectionHead"><h2>Syrové odpovědi API</h2><button className="quiet" disabled={!results.length} onClick={exportAll}>Export JSON</button></div>
   {results.length===0&&<p className="hint">Po načtení zde budou všechny získané odpovědi včetně chyb jednotlivých endpointů.</p>}
   {results.map((probe,i)=><details className="rawResponse" key={probe.id+'-'+i}>
    <summary><strong>{probe.title}</strong><span className={probe.ok?'rawOK':'rawError'}>{probe.ok?'HTTP OK':'Chyba'}</span></summary>
    <p className="rawEndpoint">{probe.url}</p>
    <p className="hint">{probe.receivedAt} · {probe.elapsedMs} ms</p>
    {probe.ok&&<div className="rawActions"><button className="quiet" onClick={()=>void navigator.clipboard?.writeText(stringify(probe.data))}>Kopírovat JSON</button><button className="quiet" onClick={()=>jsonExport('casovac-'+probe.id+'.json',probe.data)}>Uložit JSON</button></div>}
    <pre className="rawJson">{probe.ok?stringify(probe.data):probe.error}</pre>
   </details>)}
  </section>
  <p className="hint">Diagnostika je pouze pro čtení. Nemění sledovaný spoj ani nastavení Časovače. Syrová data mohou obsahovat souřadnice vozidel.</p>
 </main>;
}
