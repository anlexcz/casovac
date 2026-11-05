import {useMemo,useState} from 'react';
import {auditStopIds,stopAuditReport} from './stopAudit';
import type {Stop,TripData} from './tripData';
import {formatStopTime} from './tripData';
import type {GpsFix} from './position';
type Feature={properties?:Record<string,unknown>;geometry?:{coordinates?:unknown}};
type Props={
 active:[string,string]|null;features:Feature[];chosen:Feature|null;trip:TripData;
 gps:GpsFix|null;gpsError:string;gpsWanted:boolean;gpsAge:number|null;
 age:number|null;lastFetch:number|null;error:string;matchingCount:number;
 position:number|null;positionState:string;vehicleDistance:number|null;
 manual:number|null;setManual:(index:number|null)=>void;
 selectedTrip:string;setSelectedTrip:(id:string)=>void;
 startGps:()=>void;stopGps:()=>void;nextStopId:string;
};
const value=(v:unknown)=>v===undefined||v===null?'—':String(v);
const path=(obj:unknown,p:string):unknown=>p.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Record<string,unknown>)[k]:undefined,obj);
export default function Diagnostics({active,features,chosen,trip,gps,gpsError,gpsWanted,gpsAge,age,lastFetch,error,matchingCount,position,positionState,vehicleDistance,manual,setManual,selectedTrip,setSelectedTrip,startGps,stopGps,nextStopId}:Props){
 const stops:Stop[]=trip.stops;
 const [copyState,setCopyState]=useState('');
 const coordinates=chosen?.geometry?.coordinates;
 const vehicle:[number,number]|null=Array.isArray(coordinates)&&coordinates.length>=2&&Number.isFinite(Number(coordinates[0]))&&Number.isFinite(Number(coordinates[1]))?[Number(coordinates[0]),Number(coordinates[1])]:null;
 const stopAudit=useMemo(()=>auditStopIds(stops,nextStopId,vehicle),[stops,nextStopId,vehicle?.[0],vehicle?.[1]]);
 const report=()=>stopAuditReport(stopAudit,trip.tripId)+'\n'+stops.map(s=>s.sequence+' | '+s.name+' | '+(s.id||'(bez ID)')).join('\n');
 async function copyAudit(){try{await navigator.clipboard.writeText(report());setCopyState('Zkopírováno – bez tokenu a GPS telefonu.');}catch{setCopyState('Prohlížeč nepovolil kopírování. Otevři textový výpis níže.');}}

 return <section className="diagnosticStack" aria-label="Provozní diagnostika">
 <div className="panel"><div className="row"><h2>Živá data {active?.join('/')??'—'}</h2><span className={'status '+(age!==null&&age<50?'good':'')}>{age===null?'Bez dat':age<50?'Online':'Zastaralá data'}</span></div>
 <p className="hint">Aktualizace: {lastFetch?new Date(lastFetch).toLocaleTimeString('cs-CZ'):'—'} · stáří {age??'—'} s · obnova 20 s</p>
 <p>Na lince nalezeno {features.length} vozidel. Shody pořadí: {matchingCount}.</p>
 {error&&<p className="warn">{error}</p>}
 <label htmlFor="debugTrip">RUČNÍ VÝBĚR TRIPU</label>
 <select id="debugTrip" value={selectedTrip} onChange={e=>setSelectedTrip(e.target.value)}>
 <option value="">Automaticky dle pořadí</option>
 {features.map((f,i)=>{const id=value(path(f,'properties.trip.gtfs.trip_id')??path(f,'properties.trip.trip_id'));return <option key={i} value={id}>{value(path(f,'properties.trip.vehicle_registration_number'))} · {id} · pořadí {value(path(f,'properties.trip.sequence_id'))}</option>;})}
 </select>
 {chosen&&<div className="details">
 <div><small>TRIP ID</small><strong>{trip.tripId}</strong></div>
 <div><small>VOZIDLO</small><strong>{value(path(chosen,'properties.trip.vehicle_registration_number'))}</strong></div>
 <div><small>ZPOŽDĚNÍ</small><strong>{value(path(chosen,'properties.last_position.delay.actual'))} s</strong></div>
 <div><small>DALŠÍ ZASTÁVKA – ID</small><strong>{nextStopId}</strong></div>
 <div><small>SEQUENCE ID</small><strong>{value(path(chosen,'properties.trip.sequence_id'))}</strong></div>
 <div><small>POLOHA GOLEMIO</small><strong>{JSON.stringify(chosen.geometry?.coordinates??null)}</strong></div>
 </div>}
 <details><summary>Surová data vozidla</summary><pre>{JSON.stringify(chosen??null,null,2)}</pre></details></div>
 <div className="panel"><div className="row"><h2>Jízdní řád tripu</h2><span className={'status '+(stops.length?'good':'')}>{trip.loading?'Načítám':stops.length+' zastávek'}</span></div>
 <p className="hint">Zdroj: {trip.source||'—'} · Trip: {trip.tripId}</p>
 {trip.error&&<p className="warn">{trip.error}</p>}
 <div className="details">
 <div><small>NÁSLEDUJÍCÍ ZASTÁVKA – ID</small><strong>{nextStopId}</strong></div>
 <div><small>STAV POLOHY</small><strong>{positionState}</strong></div>
 <div><small>GPS / VOZIDLO</small><strong>{vehicleDistance??'—'} m</strong></div>
 <div><small>AKTUÁLNÍ INDEX</small><strong>{position===null?'—':position+1}</strong></div>
 </div>
 <section className="stopAudit" aria-label="Audit párování identifikátorů">
 <div className="row"><h3>Audit ID zastávek</h3><span className={'status '+(['exact','normalized'].includes(stopAudit.status)?'good':stopAudit.status==='missing'?'':'bad')}>{stopAudit.status}</span></div>
 <p className="hint">{stopAudit.message}</p>
 <div className="details">
 <div><small>ŽIVÉ ID</small><strong>{stopAudit.liveId}</strong></div>
 <div><small>ZÁKLAD KÓDU</small><strong>{stopAudit.liveBase??'—'}</strong></div>
 <div><small>GTFS ID / UNIKÁTNÍ</small><strong>{stopAudit.stopCount} / {stopAudit.uniqueGtfsIds}</strong></div>
 <div><small>CHYBĚJÍCÍ ID / DUPLICITNÍ VÝSKYTY</small><strong>{stopAudit.missingGtfsIds} / {stopAudit.duplicateGtfsIds}</strong></div>
 </div>
 <h4>Stejný identifikátor</h4>
 {stopAudit.exact.length?stopAudit.exact.map(s=><p className="auditRow" key={s.index}>{s.sequence}. {s.name} · <code>{s.id}</code></p>):<p className="hint">Žádná přesná ani normalizovaná shoda.</p>}
 <h4>Stejný základ kódu – pouze kandidáti</h4>
 {stopAudit.sameBase.length?stopAudit.sameBase.map(s=><p className="auditRow" key={s.index}>{s.sequence}. {s.name} · <code>{s.id}</code></p>):<p className="hint">Žádná shoda.</p>}
 <h4>Nejbližší k poloze vozidla</h4>
 {stopAudit.nearest.length?stopAudit.nearest.map(s=><p className="auditRow" key={s.index}>{s.sequence}. {s.name} · <code>{s.id||'bez ID'}</code> · {s.meters} m</p>):<p className="hint">Chybí souřadnice zastávek či vozidla.</p>}
 <p className="hint">Poloha slouží k diagnostice. Kandidát se automaticky nepovažuje za shodu ID.</p>
 <button className="quiet" onClick={()=>void copyAudit()}>Kopírovat anonymizovaný audit</button>
 {copyState&&<p className="hint" role="status">{copyState}</p>}
 <details><summary>Celý audit v textu</summary><pre>{report()}</pre></details>
 </section>
 <label htmlFor="debugStop">RUČNÍ KOREKCE ZASTÁVKY</label>
 <select id="debugStop" value={manual??''} onChange={e=>setManual(e.target.value===''?null:Number(e.target.value))}>
 <option value="">Automaticky GPS + Golemio</option>
 {stops.map((s,i)=><option key={i} value={i}>{s.sequence} · {s.name}</option>)}
 </select>
 <div className="stopList">{stops.map((stop,i)=><div className={'stopRow '+(position===i?'current':'')} key={i}>
 <span className="stopNum">{stop.sequence}</span><span className="stopName">{stop.name}<small>{stop.id}</small></span><span className="stopTime">{formatStopTime(stop.departure||stop.arrival)}</span>
 </div>)}</div>
 <details><summary>GTFS Lookup JSON</summary><pre>{JSON.stringify({tripId:trip.tripId,stopCount:stops.length,firstStops:stops.slice(0,3),tripFields:trip.raw&&typeof trip.raw==='object'?Object.keys(trip.raw):[],error:trip.error},null,2)}</pre></details></div>
 <div className="panel"><div className="row"><h2>GPS telefonu</h2><span className={'status '+(gpsWanted?'good':'')}>{gpsWanted?'Zapnuto':'Vypnuto'}</span></div>
 <button className="quiet" onClick={gpsWanted?stopGps:startGps}>{gpsWanted?'Vypnout GPS':'Zapnout GPS'}</button>
 {gpsError&&<p className="warn">{gpsError}</p>}
 <div className="details">
 <div><small>POLOHA TELEFONU</small><strong>{gps?gps.lat.toFixed(6)+', '+gps.lon.toFixed(6):'—'}</strong></div>
 <div><small>PŘESNOST</small><strong>{gps?'±'+Math.round(gps.accuracy)+' m':'—'}</strong></div>
 <div><small>RYCHLOST</small><strong>{gps?.speed===null||gps?.speed===undefined?'—':(gps.speed*3.6).toFixed(1)+' km/h'}</strong></div>
 <div><small>STÁŘÍ POLOHY</small><strong>{gpsAge??'—'} s</strong></div>
 </div></div>
 </section>;
}
