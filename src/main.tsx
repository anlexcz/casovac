import TripPanel from './TripPanel';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Json = Record<string, unknown>;
type Feature = { type?: string; properties?: Json; geometry?: { coordinates?: unknown }; id?: unknown };
type Gps = { lat:number; lon:number; accuracy:number; speed:number|null; timestamp:number };
const API = 'https://api.golemio.cz/v2/vehiclepositions';
const TOKEN_STORAGE_KEY='casovac:golemio-token:v1';
const readStoredToken=():string=>{try{return window.localStorage.getItem(TOKEN_STORAGE_KEY)??'';}catch{return '';}};
const field = (obj:unknown,path:string):unknown => path.split('.').reduce<unknown>((v,k)=>v && typeof v==='object' ? (v as Json)[k] : undefined,obj);
const str=(v:unknown):string=>v===undefined||v===null?'—':String(v);
const initial = (raw:string):[string,string]=>{const m=raw.trim().match(/^(\d{1,3})\s*\/\s*(\d{1,4})$/);if(!m)throw new Error('Zadej linku a pořadí ve formátu 25/5.');return [m[1],m[2]];};
const tripId=(f:Feature)=>str(field(f,'properties.trip.gtfs.trip_id') ?? field(f,'properties.trip.trip_id'));
const orderCandidates=(f:Feature)=>['trip.cis.order','trip.cis.order_number','trip.cis.sequence','trip.order','trip.order_number','trip.sequence','trip.sequence_id'].map(p=>({field:p,value:field(f.properties,p)})).filter(x=>x.value!==undefined&&x.value!==null&&x.value!=='');
const vehicleId=(f:Feature)=>str(field(f,'properties.trip.vehicle_registration_number') ?? field(f,'properties.trip.vehicle.id') ?? field(f,'properties.trip.vehicle.registration_number') ?? field(f,'properties.trip.vehicle_id'));
const stamp=(time:number|null)=>time?new Date(time).toLocaleTimeString('cs-CZ'):'—';
const errText=(e:unknown)=>e instanceof Error?e.message:String(e);
function App(){
 const [token,setToken]=useState(readStoredToken); const [settings,setSettings]=useState(false); const [showToken,setShowToken]=useState(false);
 const [rememberToken,setRememberToken]=useState(()=>!!readStoredToken()); const [storageError,setStorageError]=useState('');
 const [query,setQuery]=useState('25/5'); const [active,setActive]=useState<[string,string]|null>(null);
 const [features,setFeatures]=useState<Feature[]>([]); const [selected,setSelected]=useState<string|null>(null);
 const [error,setError]=useState('');const [lastFetch,setLastFetch]=useState<number|null>(null);const [loading,setLoading]=useState(false);
 const [gps,setGps]=useState<Gps|null>(null);const [gpsError,setGpsError]=useState('');const [gpsOn,setGpsOn]=useState(false);
 const [now,setNow]=useState(Date.now()); const [rawOpen,setRawOpen]=useState(false);
 const fetchCounter=useRef(0); const gpsWatch=useRef<number|null>(null);
 useEffect(()=>{
  try{
   if(rememberToken&&token.trim())window.localStorage.setItem(TOKEN_STORAGE_KEY,token.trim());
   else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
   setStorageError('');
  }catch{
   setStorageError('Prohlížeč nepovolil místní uložení klíče. Po obnovení stránky může zmizet.');
  }
 },[rememberToken,token]);
 function forgetToken(){
  setRememberToken(false);setToken('');setActive(null);setFeatures([]);setSelected(null);
  try{window.localStorage.removeItem(TOKEN_STORAGE_KEY);setStorageError('');}
  catch{setStorageError('Uložený klíč se nepodařilo smazat. Zkontroluj úložiště webu v nastavení prohlížeče.');}
 }

 useEffect(()=>{const t=window.setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);
 useEffect(()=>{if(!active||!token.trim())return;let cancelled=false;const controller=new AbortController();const serial=++fetchCounter.current;
 async function load(){if(cancelled)return;setLoading(true);setError('');const url=new URL(API);url.searchParams.set('routeShortName',active![0]);url.searchParams.set('limit','1000');
 try{const response=await fetch(url.toString(),{headers:{'X-Access-Token':token.trim()},signal:controller.signal,cache:'no-store'});if(!response.ok){const suffix=response.status===401||response.status===403?' – zkontroluj API klíč':response.status===429?' – překročen limit požadavků':'';throw new Error('Golemio HTTP '+response.status+suffix);}const json=await response.json() as {features?:unknown};if(!Array.isArray(json.features))throw new Error('API nevrátilo očekávaný GeoJSON seznam features.');if(cancelled||serial!==fetchCounter.current)return;setFeatures(json.features as Feature[]);setLastFetch(Date.now());}
 catch(e){if(!cancelled&&!(e instanceof DOMException&&e.name==='AbortError'))setError(errText(e)+'; případně zkontroluj CORS v konzoli prohlížeče.');}finally{if(!cancelled)setLoading(false);}}
 void load();const timer=window.setInterval(()=>void load(),20000);return()=>{cancelled=true;controller.abort();clearInterval(timer);};},[active,token]);
 useEffect(()=>()=>{if(gpsWatch.current!==null)navigator.geolocation.clearWatch(gpsWatch.current);},[]);
 function startGps(){if(!('geolocation' in navigator)){setGpsError('Prohlížeč nepodporuje geolokaci.');return;}setGpsError('');setGpsOn(true);gpsWatch.current=navigator.geolocation.watchPosition(p=>{setGps({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,speed:p.coords.speed,timestamp:p.timestamp});setGpsError('');},e=>setGpsError(e.message),{enableHighAccuracy:true,maximumAge:5000,timeout:20000});}
 function stopGps(){if(gpsWatch.current!==null)navigator.geolocation.clearWatch(gpsWatch.current);gpsWatch.current=null;setGpsOn(false);setGps(null);}
 function start(){try{const parsed=initial(query);if(!token.trim()){setSettings(true);setError('Nejdřív vlož API klíč v nastavení.');return;}setFeatures([]);setSelected(null);setLastFetch(null);setError('');setActive(parsed);}catch(e){setError(errText(e));}}
 const candidates=features.map((f,i)=>({f,id:tripId(f),key:String(i)+':'+tripId(f),order:orderCandidates(f)}));
 const matching=active?candidates.filter(c=>c.order.some(o=>String(o.value).replace(/^0+/,'')===active[1].replace(/^0+/,''))):[];
 const auto=matching.length===1?matching[0]:null;
 const chosen=candidates.find(c=>c.key===selected) ?? (selected?null:auto);
 const age=lastFetch===null?null:Math.floor((now-lastFetch)/1000);
 const gpsAge=gps?Math.floor((now-gps.timestamp)/1000):null;
 const coords=chosen?.f.geometry?.coordinates;const coordinates=Array.isArray(coords)&&coords.length>=2?coords:null;
 const info=chosen?.f.properties;
 return <main><header><div><span className="eyebrow">PID / PROVOZNÍ DIAGNOSTIKA</span><h1>ČASOVAČ<span className="dot">.</span></h1></div><button className="iconButton" onClick={()=>setSettings(true)} aria-label="Otevřít nastavení">⚙ Nastavení</button></header>
 <section className="panel"><label htmlFor="pair">LINKA / POŘADÍ</label><div className="search"><input id="pair" inputMode="text" value={query} placeholder="25/5" onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&start()}/><button className="primary" onClick={start}>Sledovat</button></div><p className="hint">Živá diagnostika. Odjezdy zatím nejsou vyhodnocovány.</p></section>
 {error&&<div className="alert" role="alert">{error}</div>}
 <section className="panel"><div className="row"><h2>Živá data {active?active.join('/'):''}</h2><span className={'status '+(error?'bad':age!==null&&age<50?'good':'')}>{loading?'Načítám…':age===null?'Neaktivní':age<50?'Online':'Zastaralá data'}</span></div><p className="hint">Poslední úspěšná aktualizace: {stamp(lastFetch)} {age===null?'':'('+age+' s zpět)'}. Obnova každých 20 s.</p>
 {active&&<><p>Na lince <b>{active[0]}</b> nalezeno <b>{features.length}</b> záznamů. Shoda pořadí <b>{active[1]}</b>: <b>{matching.length}</b>.</p><p className="hint">{matching.length===1&&!selected?'Jednoznačná shoda podle dostupného pole pořadí.': 'Automatická shoda není jednoznačná. Vyber vozidlo ručně; číslování pořadí je nutné ověřit v surových datech.'}</p><label htmlFor="vehicle">VÝBĚR VOZIDLA / TRIPU</label><select id="vehicle" value={selected??''} onChange={e=>setSelected(e.target.value||null)}><option value="">Automaticky podle pořadí (pokud je jednoznačné)</option>{candidates.map(c=><option key={c.key} value={c.key}>{vehicleId(c.f)} · {c.id} · pořadí: {c.order.map(v=>v.field+'='+v.value).join(', ')||'nezjištěno'}</option>)}</select>{features.length===1000&&<p className="warn">Dosažen limit 1000 výsledků; seznam může být neúplný.</p>}</>}
 {chosen&&<div className="details"><div><small>TRIP ID</small><strong>{chosen.id}</strong></div><div><small>VOZIDLO</small><strong>{vehicleId(chosen.f)}</strong></div><div><small>ZPOŽDĚNÍ</small><strong>{str(field(info,'last_position.delay.actual'))} s</strong></div><div><small>DALŠÍ ZASTÁVKA – ID</small><strong>{str(field(info,'last_position.next_stop.id')??field(info,'last_position.next_stop'))}</strong></div><div><small>POLOHA GOLEMIO</small><strong>{coordinates?coordinates.map(v=>Number(v).toFixed(5)).join(', '):'—'}</strong></div><div><small>POŘADÍ – MOŽNÁ POLE</small><strong>{chosen.order.map(o=>o.field+'='+o.value).join(', ')||'nenalezeno'}</strong></div></div>}
 <button className="quiet" onClick={()=>setRawOpen(v=>!v)}>{rawOpen?'Skrýt':'Zobrazit'} surová data vybraného záznamu</button>{rawOpen&&<pre>{JSON.stringify(chosen?.f??(features.length?features[0]:{message:'Zatím bez dat'}),null,2)}</pre>}</section>
 {chosen&&<TripPanel tripId={chosen.id} token={token.trim()} gps={gps} nextStopId={str(field(info,'last_position.next_stop.id')??field(info,'last_position.next_stop'))} now={now} vehicleCoords={coordinates&&Number.isFinite(Number(coordinates[0]))&&Number.isFinite(Number(coordinates[1]))?[Number(coordinates[0]),Number(coordinates[1])]:null} vehicleAge={age}/>}
 <section className="panel"><div className="row"><h2>GPS telefonu</h2><span className={'status '+(gps&&gpsAge!==null&&gpsAge<20?'good':'')}>{gpsOn?'Zapnuto':'Vypnuto'}</span></div><p className="hint">GPS se porovnává s vozidlem a zastávkami přímo v telefonu. Nic neodesíláme na vlastní server.</p><button onClick={gpsOn?stopGps:startGps} className={gpsOn?'quiet':'primary'}>{gpsOn?'Vypnout GPS':'Povolit a zapnout GPS'}</button>{gpsError&&<p className="warn">{gpsError}</p>}{gps&&<div className="details"><div><small>POLOHA TELEFONU</small><strong>{gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}</strong></div><div><small>PŘESNOST</small><strong>±{Math.round(gps.accuracy)} m</strong></div><div><small>RYCHLOST</small><strong>{gps.speed===null?'—':(gps.speed*3.6).toFixed(1)+' km/h'}</strong></div><div><small>STÁŘÍ POLOHY</small><strong>{gpsAge} s</strong></div></div>}</section>
 <footer>PROTOTYP 0.3 · Informační diagnostika, nikoli pokyn k odjezdu. Klíč lze volitelně uložit pouze do tohoto prohlížeče.</footer>
 {settings&&<div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&setSettings(false)}><div className="modal" role="dialog" aria-modal="true" aria-label="Nastavení API"><div className="row"><h2>Nastavení</h2><button className="iconButton" onClick={()=>setSettings(false)} aria-label="Zavřít">✕</button></div><label htmlFor="token">GOLEMIO API KLÍČ</label><div className="search"><input id="token" type={showToken?'text':'password'} autoComplete="off" spellCheck={false} value={token} onChange={e=>setToken(e.target.value)} placeholder="X-Access-Token"/><button onClick={()=>setShowToken(v=>!v)}>{showToken?'Skrýt':'Ukázat'}</button></div><label className="rememberOption"><input type="checkbox" checked={rememberToken} onChange={e=>setRememberToken(e.target.checked)}/><span>Zapamatovat API klíč v tomto prohlížeči</span></label>
 <p className="hint">{rememberToken?'Klíč se ukládá do místního úložiště prohlížeče (localStorage) a zůstane i po obnovení stránky. Není šifrovaný a může být dostupný skriptům či rozšířením s přístupem k webu. Na sdíleném zařízení tuto volbu vypni.':'Klíč zůstane pouze v paměti stránky a po obnovení zmizí.'} Nikdy ho neukládáme do URL ani do GitHubu. API požadavky ho posílají pouze službě Golemio.</p>
 {storageError&&<p className="warn" role="alert">{storageError}</p>}
 <button className="quiet full" onClick={forgetToken} disabled={!token&&!rememberToken}>Zapomenout klíč z tohoto zařízení</button>
 <button className="primary full" onClick={()=>setSettings(false)}>Hotovo</button></div></div>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
