import type {RemoteProgress} from './remoteProgress';
import type {LastSeen} from './lastSeen';
import type {OnboardDecision} from './onboard';
import type {RemoteState} from './remoteTracking';
import type {useRecorder} from './recorder';
import type {DepartureTelemetry} from './departure';
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
 startGps:()=>void;stopGps:()=>void;nextStopId:string;departure:DepartureTelemetry;
 remote:RemoteState;remoteProgress:RemoteProgress;onboard:boolean;onboardDecision:OnboardDecision;
 terminalWaiting:boolean;terminalName:string|null;queryMode:string;terminalCandidates:unknown[];
 lastSeen:LastSeen|null;relatedVehicle:{vehicle:string;route:string;order:string;state:string;time:number}|null;
 recorder:ReturnType<typeof useRecorder>;
};
const value=(v:unknown)=>v===undefined||v===null?'—':String(v);
const path=(obj:unknown,p:string):unknown=>p.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Record<string,unknown>)[k]:undefined,obj);
export default function Diagnostics({active,features,chosen,trip,gps,gpsError,gpsWanted,gpsAge,age,lastFetch,error,matchingCount,position,positionState,vehicleDistance,manual,setManual,selectedTrip,setSelectedTrip,startGps,stopGps,nextStopId,departure,remote,remoteProgress,onboard,onboardDecision,terminalWaiting,terminalName,queryMode,terminalCandidates,lastSeen,relatedVehicle,recorder}:Props){
 const stops:Stop[]=trip.stops;
 const [copyState,setCopyState]=useState('');
 const [includePhone,setIncludePhone]=useState(false);
 const [scenario,setScenario]=useState<'gps-off'|'gps-remote'|'gps-onboard'>('gps-off');
 const [note,setNote]=useState('');
 const coordinates=chosen?.geometry?.coordinates;
 const vehicle:[number,number]|null=Array.isArray(coordinates)&&coordinates.length>=2&&Number.isFinite(Number(coordinates[0]))&&Number.isFinite(Number(coordinates[1]))?[Number(coordinates[0]),Number(coordinates[1])]:null;
 const stopAudit=useMemo(()=>auditStopIds(stops,nextStopId,vehicle),[stops,nextStopId,vehicle?.[0],vehicle?.[1]]);
 const report=()=>stopAuditReport(stopAudit,trip.tripId)+'\n'+stops.map(s=>s.sequence+' | '+s.name+' | '+(s.id||'(bez ID)')).join('\n');
 async function copyAudit(){try{await navigator.clipboard.writeText(report());setCopyState('Zkopírováno – bez tokenu a GPS telefonu.');}catch{setCopyState('Prohlížeč nepovolil kopírování. Otevři textový výpis níže.');}}

 return <section className="diagnosticStack" aria-label="Provozní diagnostika">
 <section className="panel recorderPanel" aria-label="Záznam diagnostiky">
  <div className="row"><h2>Záznam testovací jízdy</h2><span className={'status '+(recorder.session?.state==='recording'?'good':'')}>{recorder.session?.state==='recording'?'Zaznamenávám':recorder.session?'Ukončeno':'Připraveno'}</span></div>
  <p className="hint">Ukládá každou odpověď Golemia pro sledované pořadí, včetně opakovaných identických hlášení, času požadavku a případných chyb. Interval 20 s. Zůstává pouze v tomto prohlížeči.</p>
  {recorder.session?<div className="details">
    <div><small>SLEDOVANÉ POŘADÍ / TEST</small><strong>{recorder.session.target.line}/{recorder.session.target.order} · {recorder.session.options.testScenario??'nezadáno'}</strong></div>
    <div><small>ZÁZNAMŮ</small><strong>{recorder.session.events.length} / {recorder.session.limits.maxEvents}</strong></div>
    <div><small>ZAČÁTEK</small><strong>{new Date(recorder.session.startedAt).toLocaleString('cs-CZ')}</strong></div>
    <div><small>POSLEDNÍ VZOREK</small><strong>{recorder.session.events.length?new Date(recorder.session.events[recorder.session.events.length-1].receivedAt).toLocaleTimeString('cs-CZ'):'—'}</strong></div>
   </div>:<div className="recorderSetup">
    <label htmlFor="testScenario">TESTOVACÍ SITUACE</label>
    <select id="testScenario" value={scenario} onChange={e=>setScenario(e.target.value as 'gps-off'|'gps-remote'|'gps-onboard')}>
     <option value="gps-off">1 · Vypnutá GPS telefonu</option>
     <option value="gps-remote">2 · GPS zapnutá, telefon mimo tramvaj</option>
     <option value="gps-onboard">3 · GPS zapnutá, telefon v tramvaji</option>
    </select>
    <label className="rememberOption"><input type="checkbox" checked={includePhone} onChange={e=>setIncludePhone(e.target.checked)}/><span>Do JSON zahrnout i souřadnice GPS telefonu (volitelné; může prozradit soukromá místa). Bez zaškrtnutí se ukládá pouze stav GPS a vzdálenost od tramvaje.</span></label>
   </div>}
  {recorder.session?.state==='recording'&&<>
   <p className="hint">Při obnovení stránky záznam zůstane uložený. Pro další sběr musí být aktivní sledování stejného pořadí. Při zablokování prohlížeče na pozadí mohou jednotlivé vzorky chybět.</p>
   <div className="search"><input aria-label="Poznámka do záznamu" placeholder="Poznámka: konečná, semafor, odklon…" value={note} onChange={e=>setNote(e.target.value)}/><button className="quiet" disabled={!note.trim()} onClick={()=>{recorder.note(note);setNote('');}}>Přidat</button></div>
  </>}
  <div className="recorderActions">
   {!recorder.session&&<button className="primary" disabled={!recorder.ready||!active} onClick={()=>{if(active)recorder.start(active[0],active[1],includePhone,scenario);}}>● Spustit záznam</button>}
   {recorder.session?.state==='recording'&&<button className="primary" onClick={recorder.stop}>■ Ukončit záznam</button>}
   {recorder.session&&<button className="quiet" onClick={recorder.download}>↓ Stáhnout JSON ({recorder.session.events.length})</button>}
   {recorder.session?.state==='stopped'&&<button className="quiet" onClick={()=>{if(window.confirm('Smazat uložený záznam? Nejprve jej stáhni.'))recorder.discard();}}>Smazat záznam</button>}
  </div>
  {recorder.error&&<p className="warn" role="alert">{recorder.error}</p>}
  {recorder.session&&<p className="hint">Export JSON neobsahuje API token. {recorder.session.options.includePhoneCoordinates?'Souřadnice telefonu jsou součástí exportu.':'Souřadnice telefonu nejsou součástí exportu.'} Po stažení lze soubor rovnou nahrát do chatu.</p>}
 </section>
 <section className="panel remotePanel" aria-label="Vzdálené sledování">
  <div className="row"><h2>Sledování vozidla</h2><span className={'status '+(onboard?'good':'')}>{onboard?'GPS na palubě':'Vzdálený režim'}</span></div>
  <p className="hint">{onboard?'Telefon je spárovaný s tramvají.':'GPS telefonu není ověřená na palubě; řídí se údaji Golemia.'} {onboardDecision.reason}</p>
  <div className="details">
   <div><small>GPS / VOZIDLO</small><strong>{onboardDecision.gap===null?'—':Math.round(onboardDecision.gap)+' m'}</strong></div>
   <div><small>GPS / PLÁNOVANÁ TRASA</small><strong>{onboardDecision.routeGap===null?'—':Math.round(onboardDecision.routeGap)+' m'}</strong></div>
   <div><small>POSLEDNÍ SPÁROVÁNÍ</small><strong>{onboardDecision.lastPairedAt===null?'—':new Date(onboardDecision.lastPairedAt).toLocaleTimeString('cs-CZ')}</strong></div>
   <div><small>REŽIM DOTAZU</small><strong>{queryMode}</strong></div>
   <div><small>STAV NA KONEČNÉ</small><strong>{terminalWaiting?'Čeká · '+(terminalName??'—'):'Nepotvrzeno'}</strong></div>
   <div><small>POČET KANDIDÁTŮ</small><strong>{terminalCandidates.length}</strong></div>
   <div><small>POSLEDNÍ ZNÁMÝ VŮZ</small><strong>{lastSeen?.vehicle??'—'}</strong></div>
   <div><small>POSLEDNÍ VÝSKYT</small><strong>{lastSeen?new Date(lastSeen.lastSeenAt).toLocaleString('cs-CZ'):'—'}</strong></div>
   <div><small>VOZIDLO NA JINÉM TRIPU</small><strong>{relatedVehicle?relatedVehicle.route+'/'+relatedVehicle.order+' · '+relatedVehicle.state:'Neověřeno'}</strong></div>
  </div>
  <details><summary>Kandidáti z posledního dotazu</summary><pre>{JSON.stringify(terminalCandidates,null,2)}</pre></details>
  <div className="details">
   <div><small>STAV PREDIKCE</small><strong>{remote.status}</strong></div>
   <div><small>VÝBĚR BEZ GPS</small><strong>{remoteProgress.predicted?'Predikovaný odjezd':'Potvrzený stav'}</strong></div>
   <div><small>OD POSLEDNÍHO HLÁŠENÍ V ZASTÁVCE</small><strong>{remoteProgress.atStopAge===null?'—':Math.round(remoteProgress.atStopAge)+' s'}</strong></div>
   <div><small>PRÁH PREDIKCE</small><strong>{remoteProgress.threshold===null?'—':remoteProgress.threshold+' s'}</strong></div>
   <div><small>ZOBRAZENÝ INDEX BEZ GPS</small><strong>{remoteProgress.index===null?'—':remoteProgress.index+1}</strong></div>
   <div><small>STAV VOZIDLA</small><strong>{remote.vehicleState}</strong></div>
   <div><small>ZDROJ URČENÍ ZASTÁVKY</small><strong>{remote.source}</strong></div>
   <div><small>POSLEDNÍ / DALŠÍ ZASTÁVKA</small><strong>{remote.previousIndex===null?'—':stops[remote.previousIndex]?.name??'—'} / {remote.nextIndex===null?'—':stops[remote.nextIndex]?.name??'—'}</strong></div>
   <div><small>ODHADOVANÁ ZASTÁVKA</small><strong>{remote.index===null?'—':(stops[remote.index]?.name??'—')}</strong></div>
   <div><small>STÁŘÍ POLOHY VOZIDLA</small><strong>{remote.sourceAge===null?'Čas měření není k dispozici':remote.sourceAge+' s'}</strong></div>
   <div><small>STÁŘÍ API ODPOVĚDI</small><strong>{remote.apiAge===null?'—':remote.apiAge+' s'}</strong></div>
   <div><small>POLOHA NA TRASE</small><strong>{remote.vehicleProgress===null?'—':Math.round(remote.vehicleProgress)+' m'}</strong></div>
   <div><small>ODCHYLKA OD TRASY</small><strong>{remote.crossTrack===null?'—':Math.round(remote.crossTrack)+' m'}</strong></div>
   <div><small>PREDIKOVANÁ POLOHA</small><strong>{remote.predictedProgress===null?'—':Math.round(remote.predictedProgress)+' m'}</strong></div>
   <div><small>ODHAD RYCHLOSTI</small><strong>{remote.estimatedSpeed===null?'—':remote.estimatedSpeed.toFixed(1)+' km/h'}</strong></div>
  </div>
  <p className="hint">{remoteProgress.reason}</p>
 </section>
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
 <section className="departureAudit" aria-label="Detekce opuštění zastávky">
 <div className="row"><h3>Detekce odjezdu</h3><span className={'status '+(departure.phase==='left'?'good':'')}>{departure.phase}</span></div>
 <p className="hint">{departure.reason}</p>
 <div className="details">
 <div><small>MONITOROVANÁ ZASTÁVKA</small><strong>{departure.stopIndex===null?'—':(stops[departure.stopIndex]?.name??'—')}</strong></div>
 <div><small>ZOBRAZENÝ INDEX</small><strong>{departure.displayIndex===null?'—':departure.displayIndex+1}</strong></div>
 <div><small>VZDÁLENOST OD ZASTÁVKY</small><strong>{departure.distance===null?'—':departure.distance+' m'} / 50 m</strong></div>
 <div><small>POSTUP PO TRASE</small><strong>{departure.along===null?'—':departure.along.toFixed(1)+' m'} / 50 m</strong></div>
 <div><small>RYCHLOST</small><strong>{departure.speed===null?'—':departure.speed.toFixed(1)+' km/h'} / 9 km/h</strong></div>
 <div><small>POTVRZENÍ GPS</small><strong>{departure.samples}/3 měření · {departure.seconds.toFixed(1)}/4 s</strong></div>
 <div><small>NÁRŮST VZDÁLENOSTI</small><strong>{departure.increase===null?'—':departure.increase+' m'} / 15 m</strong></div>
 <div><small>ODCHYLKA OD TRASY</small><strong>{departure.crossTrack===null?'—':departure.crossTrack.toFixed(1)+' m'}</strong></div>
 <div><small>GTFS SHAPE</small><strong>{departure.routeReady?'Načtená':'Není použitelná'}</strong></div>
 <div><small>POSLEDNÍ PŘEPNUTÍ</small><strong>{departure.lastSwitch??'—'}</strong></div>
 </div>
 <p className="hint">Přepnutí se provádí až po potvrzeném odjezdu z prostoru zastávky. Rychlost, postup po trase i vzdálenost musejí odpovídat. Po obnovení webu se detekce z bezpečnostních důvodů znovu inicializuje.</p>
 </section>
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
