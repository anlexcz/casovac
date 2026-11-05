import {useEffect,useMemo,useState} from 'react';
type Obj=Record<string,unknown>;
type Stop={id:string;name:string;sequence:number;arrival:string;departure:string;lat:number|null;lon:number|null};
type Gps={lat:number;lon:number;accuracy:number;speed:number|null;timestamp:number};
type Props={tripId:string;token:string;gps:Gps|null;nextStopId:string;now:number};
const get=(value:unknown,path:string):unknown=>path.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Obj)[k]:undefined,value);
const first=(o:unknown,paths:string[]):unknown=>paths.map(p=>get(o,p)).find(v=>v!==undefined&&v!==null&&v!=='');
const text=(v:unknown)=>v===undefined||v===null?'':String(v);
const numeric=(v:unknown):number|null=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
function distance(a:number,b:number,c:number,d:number){const rad=Math.PI/180;const x=(d-b)*rad*Math.cos((a+c)/2*rad);const y=(c-a)*rad;return Math.round(Math.hypot(x,y)*6371000);}
function parseTrip(raw:unknown):Stop[]{
 const payload=first(raw,['data','result','trip'])??raw;
 const items=first(payload,['stop_times','stopTimes','stop_times.data','stops','properties.stop_times','trip.stop_times','data.stop_times','stops.features','stop_times.features','stop_times.features.data','stopTimes.features']);
 if(!Array.isArray(items))return [];
 return items.map((s:unknown,i)=>{
 const stop=first(s,['stop','stop_info','stop_data','properties.stop'])??{};
 const loc=first(stop,['geometry.coordinates','coordinates']);
 const coords=Array.isArray(loc)?loc:[];
 return {id:text(first(s,['stop_id','stopId','stop.id','stop.stop_id','stop.properties.stop_id','stop.properties.id','properties.stop_id','properties.stop.id'])??first(stop,['id','stop_id'])),
 name:text(first(s,['stop_name','stopName','stop.name','stop.properties.stop_name','stop.properties.name','properties.stop_name','properties.stop.name'])??first(stop,['name','stop_name']))||'Neznámá zastávka',
 sequence:numeric(first(s,['stop_sequence','stopSequence','sequence','properties.stop_sequence']))??i+1,
 arrival:text(first(s,['arrival_time','arrivalTime','arrival.time','arrival','properties.arrival_time'])),
 departure:text(first(s,['departure_time','departureTime','departure.time','departure','properties.departure_time'])),
 lat:numeric(first(s,['stop_lat','lat','stop.lat','stop.geometry.coordinates.1','stop.properties.stop_lat'])??coords[1]),
 lon:numeric(first(s,['stop_lon','lon','stop.lon','stop.geometry.coordinates.0','stop.properties.stop_lon'])??coords[0])
 };
 }).sort((a,b)=>a.sequence-b.sequence);
}
function fmtTime(value:string){if(!value)return '—';if(/^\d{1,2}:\d\d(:\d\d)?$/.test(value))return value;const d=new Date(value);return Number.isNaN(d.valueOf())?value:d.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
export default function TripPanel({tripId,token,gps,nextStopId,now}:Props){
 const [raw,setRaw]=useState<unknown>(null);const [stopTimesRaw,setStopTimesRaw]=useState<unknown>(null);const [stopsSource,setStopsSource]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 const [manual,setManual]=useState<number|null>(null);const [debug,setDebug]=useState(false);
 useEffect(()=>{if(!tripId||tripId==='—'||!token)return;const controller=new AbortController();setRaw(null);setStopTimesRaw(null);setStopsSource('');setError('');setLoading(true);setManual(null);
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
 if(!parseTrip(stopData).length)setError('Samostatný endpoint odpověděl, ale seznam zastávek nebyl rozpoznán. Zkontroluj stručnou diagnostiku.');
 }catch(e){if(!controller.signal.aborted)setError(String(e));}finally{if(!controller.signal.aborted)setLoading(false);}})();
 return ()=>controller.abort();
 },[tripId,token]);
 const stops=useMemo(()=>{const secondary=parseTrip(stopTimesRaw);return secondary.length?secondary:parseTrip(raw);},[raw,stopTimesRaw]);
 const nextIndex=stops.findIndex(s=>s.id&&s.id===nextStopId);
 const position=manual??(nextIndex>=0?nextIndex:null);
 const gpsAge=gps?Math.max(0,Math.floor((now-gps.timestamp)/1000)):null;
 const gpsReliable=!!gps&&gps.accuracy<=50&&gpsAge!==null&&gpsAge<=20;
 const closest=gpsReliable?stops.map((s,i)=>({...s,i,metres:s.lat===null||s.lon===null?Infinity:distance(gps!.lat,gps!.lon,s.lat,s.lon)})).sort((a,b)=>a.metres-b.metres)[0]:undefined;
 return <section className="panel"><div className="row"><h2>Jízdní řád tripu</h2><span className={'status '+(stops.length?'good':'')}>{loading?'Načítám…':stops.length?stops.length+' zastávek':'Neověřeno'}</span></div>
 <p className="hint">Trip: {tripId}. {stopsSource||'Zjišťování zdroje zastávkových časů'}. GPS je pouze nezávislá kontrola.</p>
 {error&&<p className="warn">{error}. Ověř dostupnost endpointu a oprávnění API klíče.</p>}
 {raw!==null&&!stops.length&&<p className="warn">Zatím nebyly získány zastávkové časy. Samotné pole shapes obsahuje geometrii trasy, nikoli jízdní řád.</p>}
 {stops.length>0&&<><div className="details"><div><small>DALŠÍ ZASTÁVKA PODLE GOLEMIA</small><strong>{nextIndex>=0?stops[nextIndex].name:nextStopId||'Nezjištěna'}</strong></div><div><small>GPS – NEJBLIŽŠÍ ZASTÁVKA</small><strong>{closest&&Number.isFinite(closest.metres)?closest.name+' ('+closest.metres+' m)':'Nelze určit'}</strong></div></div>
 <p className="hint">{nextIndex<0?'ID další zastávky nelze spojit s GTFS; automatické určení pořadí zastávky není potvrzené.':'Další zastávka byla spárována podle ID. V této verzi ji záměrně nepřepínáme jen podle nejbližší GPS.'} {gps&&!gpsReliable?'GPS zatím není dostatečně přesná nebo aktuální.':''}</p>
 <label htmlFor="manualStop">RUČNÍ KONTROLA ZASTÁVKY (NEOVLIVŇUJE GOLEMIO)</label>
 <select id="manualStop" value={manual??''} onChange={e=>setManual(e.target.value===''?null:Number(e.target.value))}><option value="">Automaticky dle ID další zastávky</option>{stops.map((s,i)=><option key={i} value={i}>{s.sequence}. {s.name}</option>)}</select>
 <div className="stopList">{stops.map((s,i)=><div className={'stopRow '+(i===position?'current':'')} key={i}><span className="stopNum">{s.sequence}</span><span className="stopName">{s.name}<small>{s.id}</small></span><span className="stopTime">{fmtTime(s.departure||s.arrival)}</span>{gpsReliable&&s.lat!==null&&s.lon!==null&&<span className="stopDistance">{distance(gps!.lat,gps!.lon,s.lat,s.lon)} m</span>}</div>)}</div></>}
 <button className="quiet" onClick={()=>setDebug(v=>!v)}>{debug?'Skrýt':'Zobrazit'} diagnostiku GTFS Lookup</button>{debug&&<pre>{JSON.stringify({tripId,source:stopsSource,error,tripFields:raw&&typeof raw==='object'?Object.keys(raw):[],stopTimesFields:stopTimesRaw&&typeof stopTimesRaw==='object'?Object.keys(stopTimesRaw):[],stopTimesPreview:Array.isArray(stopTimesRaw)?stopTimesRaw.slice(0,2):null,tripMetadata:raw&&typeof raw==='object'?Object.fromEntries(Object.entries(raw as Obj).filter(([k])=>k!=='shapes'&&k!=='stop_times'&&k!=='stops')):raw},null,2).slice(0,14000)}</pre>}
 </section>;
}
