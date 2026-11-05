import {useEffect,useMemo,useRef,useState} from 'react';
type Obj=Record<string,unknown>;
type Stop={id:string;name:string;sequence:number;arrival:string;departure:string;lat:number|null;lon:number|null};
type Gps={lat:number;lon:number;accuracy:number;speed:number|null;timestamp:number};
type Props={tripId:string;token:string;gps:Gps|null;nextStopId:string;now:number;vehicleCoords:[number,number]|null;vehicleAge:number|null};
const get=(value:unknown,path:string):unknown=>path.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Obj)[k]:undefined,value);
const first=(o:unknown,paths:string[]):unknown=>paths.map(p=>get(o,p)).find(v=>v!==undefined&&v!==null&&v!=='');
const text=(v:unknown)=>v===undefined||v===null?'':String(v);
const numeric=(v:unknown):number|null=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
function distance(a:number,b:number,c:number,d:number){const rad=Math.PI/180;const x=(d-b)*rad*Math.cos((a+c)/2*rad);const y=(c-a)*rad;return Math.round(Math.hypot(x,y)*6371000);}
function stopArray(raw:unknown):unknown[]{
 const payload=first(raw,['data','result','trip'])??raw;
 const queue:unknown[]=[payload];
 const seen=new Set<unknown>();
 for(let iterations=0;queue.length&&iterations<32;iterations++){
  const node=queue.shift();
  if(node===null||node===undefined||seen.has(node))continue;
  seen.add(node);
  if(Array.isArray(node)){
   if(node.length&&node.some(v=>typeof v==='object'&&v!==null&&(
    first(v,['stop_id','stopId','stop_sequence','stopSequence','arrival_time','departure_time','properties.stop_id','properties.stop_sequence','stop.id','stop_name','properties.stop_name'])!==undefined
   )))return node;
   continue;
  }
  if(typeof node==='object'){
   for(const key of ['stop_times','stopTimes','stop_times_data','stoptimes','stops','features','data','result','items','records']){
    if(key in (node as Obj))queue.push((node as Obj)[key]);
   }
  }
 }
 return [];
}
function parseTrip(raw:unknown):Stop[]{
 const items=stopArray(raw);
 return items.map((s:unknown,i)=>{
 const stop=first(s,['stop','stop_info','stop_data','properties.stop'])??{};
 const loc=first(stop,['geometry.coordinates','coordinates'])??first(s,['geometry.coordinates']);
 const coords=Array.isArray(loc)?loc:[];
 return {id:text(first(s,['stop_id','stopId','stop.id','stop.stop_id','stop.properties.stop_id','stop.properties.id','properties.stop_id','properties.stop.id','properties.id'])??first(stop,['id','stop_id'])),
 name:text(first(s,['stop_name','stopName','stop.name','stop.properties.stop_name','stop.properties.name','properties.stop_name','properties.stop.name'])??first(stop,['name','stop_name']))||'Neznámá zastávka',
 sequence:numeric(first(s,['stop_sequence','stopSequence','sequence','properties.stop_sequence']))??i+1,
 arrival:text(first(s,['arrival_time','arrivalTime','arrival.time','arrival','properties.arrival_time'])),
 departure:text(first(s,['departure_time','departureTime','departure.time','departure','properties.departure_time'])),
 lat:numeric(first(s,['stop_lat','lat','stop.lat','stop.geometry.coordinates.1','stop.properties.stop_lat','properties.stop_lat'])??coords[1]),
 lon:numeric(first(s,['stop_lon','lon','stop.lon','stop.geometry.coordinates.0','stop.properties.stop_lon','properties.stop_lon'])??coords[0])
 };
 }).sort((a,b)=>a.sequence-b.sequence);
}
function preview(value:unknown):unknown{
 if(Array.isArray(value))return {type:'array',length:value.length,first:value.slice(0,2)};
 if(value&&typeof value==='object'){
  const obj=value as Obj;return {type:'object',keys:Object.keys(obj),sample:Object.fromEntries(Object.entries(obj).filter(([k])=>!['shapes','geometry'].includes(k)).slice(0,5).map(([k,v])=>[k,Array.isArray(v)?{type:'array',length:v.length,first:v.slice(0,2)}:v]))};
 }
 return value;
}
function fmtTime(value:string){if(!value)return '—';if(/^\d{1,2}:\d\d(:\d\d)?$/.test(value))return value;const d=new Date(value);return Number.isNaN(d.valueOf())?value:d.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
export default function TripPanel({tripId,token,gps,nextStopId,now,vehicleCoords,vehicleAge}:Props){
 const [raw,setRaw]=useState<unknown>(null);const [stopTimesRaw,setStopTimesRaw]=useState<unknown>(null);const [stopsSource,setStopsSource]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 const [manual,setManual]=useState<number|null>(null);const [debug,setDebug]=useState(false);
 const [gpsConfirmed,setGpsConfirmed]=useState<number|null>(null);
 const gpsCandidate=useRef<{index:number;first:number;count:number}|null>(null);const lastGpsTimestamp=useRef<number>(0);
 useEffect(()=>{if(!tripId||tripId==='—'||!token)return;const controller=new AbortController();setRaw(null);setStopTimesRaw(null);setStopsSource('');setError('');setLoading(true);setManual(null);setGpsConfirmed(null);gpsCandidate.current=null;lastGpsTimestamp.current=0;
 const url=new URL('https://api.golemio.cz/v2/public/gtfs/trips/'+encodeURIComponent(tripId));
 url.searchParams.append('scopes[]','info');url.searchParams.append('scopes[]','stop_times');url.searchParams.append('scopes[]','shapes');
 (async()=>{try{
 const headers={'X-Access-Token':token};
 const response=await fetch(url,{headers,signal:controller.signal,cache:'no-store'});
 if(!response.ok)throw Error('GTFS Lookup HTTP '+response.status);
 const data:unknown=await response.json();if(controller.signal.aborted)return;
 setRaw(data);
 if(parseTrip(data).length){setStopsSource('Součást detailu tripu');return;}
 // Detail tripu může poskytovat geometrii bez zastávkových časů.
 // Zkusíme dedikovaný GTFS endpoint pro stop_times daného tripu.
 const fallbackUrl='https://api.golemio.cz/v2/gtfs/stoptimes/'+encodeURIComponent(tripId);
 const fallback=await fetch(fallbackUrl,{headers,signal:controller.signal,cache:'no-store'});
 if(!fallback.ok){setError('Detail tripu neobsahuje stop_times; samostatný endpoint vrátil HTTP '+fallback.status+'.');return;}
 const stopData:unknown=await fallback.json();if(controller.signal.aborted)return;
 setStopTimesRaw(stopData);setStopsSource('Samostatný GTFS stop_times endpoint');
 if(!parseTrip(stopData).length)setError('Zastávkové časy nebyly rozpoznány. Diagnostika nyní ukazuje strukturu pole stop_times a první dva záznamy.');
 }catch(e){if(!controller.signal.aborted)setError(String(e));}finally{if(!controller.signal.aborted)setLoading(false);}})();
 return ()=>controller.abort();
 },[tripId,token]);
 const stops=useMemo(()=>{const secondary=parseTrip(stopTimesRaw);return secondary.length?secondary:parseTrip(raw);},[raw,stopTimesRaw]);
 const nextIndex=stops.findIndex(s=>s.id&&s.id===nextStopId);
 const gpsAge=gps?Math.max(0,Math.floor((now-gps.timestamp)/1000)):null;
 const gpsReliable=!!gps&&gps.accuracy<=35&&gpsAge!==null&&gpsAge<=15;
 const vehicleDistance=vehicleCoords&&gps?distance(gps.lat,gps.lon,vehicleCoords[1],vehicleCoords[0]):null;
 const vehicleMatched=gpsReliable&&vehicleDistance!==null&&vehicleDistance<=180&&vehicleAge!==null&&vehicleAge<=45;
 const closest=gpsReliable?stops.map((stop,i)=>({...stop,i,metres:stop.lat===null||stop.lon===null?Infinity:distance(gps!.lat,gps!.lon,stop.lat,stop.lon)})).sort((a,b)=>a.metres-b.metres)[0]:undefined;
 // GPS can verify the vicinity of a stop but cannot authorize departure.
 // Limit selection to the stop immediately before/at the API-reported next stop.
 const gpsNear=vehicleMatched&&nextIndex>=0&&closest&&Number.isFinite(closest.metres)&&closest.metres<=Math.max(35,Math.min(75,2*(gps?.accuracy??0)))&&
 (closest.i===nextIndex||closest.i===nextIndex-1)?closest:null;
 useEffect(()=>{
  if(!gps||gps.timestamp===lastGpsTimestamp.current)return;
  lastGpsTimestamp.current=gps.timestamp;
  if(!gpsNear){gpsCandidate.current=null;setGpsConfirmed(null);return;}
  const existing=gpsCandidate.current;
  if(!existing||existing.index!==gpsNear.i||gps.timestamp-existing.first>20000){
   gpsCandidate.current={index:gpsNear.i,first:gps.timestamp,count:1};
   setGpsConfirmed(null);return;
  }
  gpsCandidate.current={...existing,count:existing.count+1};
  if(existing.count>=1&&gps.timestamp-existing.first>=3000)setGpsConfirmed(gpsNear.i);
 },[gps,gpsNear?.i,gpsNear?.metres]);
 useEffect(()=>{gpsCandidate.current=null;setGpsConfirmed(null);},[tripId,nextIndex]);
 const position=manual??(gpsConfirmed!==null?gpsConfirmed:nextIndex>=0?nextIndex:null);
 const gpsState=!gps?'GPS vypnuta':!gpsReliable?'GPS nepřesná nebo zastaralá':!vehicleMatched?'Telefon není spolehlivě spárován s vozidlem':gpsConfirmed!==null?'GPS ověřila blízkost zastávky':gpsNear?'Čekám na další GPS měření':'GPS zatím není u očekávané zastávky';
 return <section className="panel"><div className="row"><h2>Jízdní řád tripu</h2><span className={'status '+(stops.length?'good':'')}>{loading?'Načítám…':stops.length?stops.length+' zastávek':'Neověřeno'}</span></div>
 <p className="hint">Trip: {tripId}. {stopsSource||'Zjišťování zdroje zastávkových časů'}. GPS je pouze nezávislá kontrola.</p>
 {error&&<p className="warn">{error}. Ověř dostupnost endpointu a oprávnění API klíče.</p>}
 {raw!==null&&!stops.length&&<p className="warn">Zatím nebyly získány zastávkové časy. Samotné pole shapes obsahuje geometrii trasy, nikoli jízdní řád.</p>}
 {stops.length>0&&<><div className="details"><div><small>DALŠÍ ZASTÁVKA PODLE GOLEMIA</small><strong>{nextIndex>=0?stops[nextIndex].name:nextStopId||'Nezjištěna'}</strong></div><div><small>GPS – NEJBLIŽŠÍ ZASTÁVKA</small><strong>{closest&&Number.isFinite(closest.metres)?closest.name+' ('+closest.metres+' m)':'Nelze určit'}</strong></div></div>
 <div className="gpsProgress"><span className={'status '+(gpsConfirmed!==null?'good':'')}>{gpsState}</span><p className="hint">Golemio určuje následující zastávku, GPS pouze zvýrazní potvrzenou blízkou zastávku. Potřeba 2 různých GPS měření s odstupem alespoň 3 s, přesnost nejvýše 35 m, soulad s vozidlem do 180 m. Při nejistotě přebírá vedení Golemio.</p>{vehicleDistance!==null&&<p className="hint">Telefon vůči vozidlu: {vehicleDistance} m · stáří dat vozidla {vehicleAge??'—'} s.</p>}</div>
 <p className="hint">{nextIndex<0?'ID další zastávky nelze spojit s GTFS; GPS z bezpečnostních důvodů nemůže měnit zvýraznění.':'Zvýraznění je jen odhad polohy na trase, nikoli potvrzení možnosti odjezdu.'}</p>
 <label htmlFor="manualStop">RUČNÍ KONTROLA ZASTÁVKY (NEOVLIVŇUJE GOLEMIO)</label>
 <select id="manualStop" value={manual??''} onChange={e=>setManual(e.target.value===''?null:Number(e.target.value))}><option value="">Automaticky dle ID další zastávky</option>{stops.map((s,i)=><option key={i} value={i}>{s.sequence}. {s.name}</option>)}</select>
 <div className="stopList">{stops.map((s,i)=><div className={'stopRow '+(i===position?'current':'')} key={i}><span className="stopNum">{s.sequence}</span><span className="stopName">{s.name}<small>{s.id}</small></span><span className="stopTime">{fmtTime(s.departure||s.arrival)}</span>{gpsReliable&&s.lat!==null&&s.lon!==null&&<span className="stopDistance">{distance(gps!.lat,gps!.lon,s.lat,s.lon)} m</span>}</div>)}</div></>}
 <button className="quiet" onClick={()=>setDebug(v=>!v)}>{debug?'Skrýt':'Zobrazit'} diagnostiku GTFS Lookup</button>{debug&&<pre>{JSON.stringify({tripId,source:stopsSource,error,tripFields:raw&&typeof raw==='object'?Object.keys(raw):[],tripStopTimes:preview(get(raw,'stop_times')),fallbackStopTimes:preview(stopTimesRaw),parsedStops:stops.slice(0,2)},null,2).slice(0,12000)}</pre>}
 </section>;
}
