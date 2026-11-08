import {useEffect,useState} from 'react';
import {phase2CacheInfo,clearPhase2Cache,phase2Scenarios,runPhase2Scenario} from './pidPhase2Diagnostics.ts';
import type {Phase2Result,Phase2Scenario} from './pidPhase2Diagnostics.ts';
import type {PidCacheInfo} from './pidPersistentCache.ts';
import {pidStatic} from './pidStatic.ts';
import type {PidManifest} from './pidStatic.ts';

const formatBytes=(bytes:number)=>bytes>=1048576?(bytes/1048576).toFixed(2)+' MiB':
 bytes>=1024?(bytes/1024).toFixed(1)+' KiB':bytes+' B';
const stamp=(value:string)=>new Date(value).toLocaleString('cs-CZ',{dateStyle:'short',timeStyle:'medium'});
export default function PidPhase2Panel({tripId,date}:{tripId:string;date:string}){
 const [busy,setBusy]=useState<Phase2Scenario|'all'|'clear'|'refresh'|null>(null);
 const [manifest,setManifest]=useState<PidManifest|null>(null);
 const [manifestError,setManifestError]=useState('');
 const [cache,setCache]=useState<PidCacheInfo|null>(null);
 const [results,setResults]=useState<Phase2Result[]>([]);
 const [note,setNote]=useState('');
 const refresh=async()=>{
  try{
   const [m,info]=await Promise.all([pidStatic.getManifest(true),phase2CacheInfo()]);
   setManifest(m);setManifestError('');setCache(info);
  }catch(e){
   setManifestError(e instanceof Error?e.message:String(e));
   setCache(await phase2CacheInfo());
  }
 };
 useEffect(()=>{void refresh();},[]);
 const run=async(ids:Phase2Scenario[])=>{
  setBusy(ids.length===1?ids[0]:'all');setNote('');
  const collected:Phase2Result[]=[];
  try{
   for(const id of ids){
    const result=await runPhase2Scenario(id,date,tripId);
    collected.push(result);
    setResults(old=>[...old.filter(item=>item.id!==id),result]);
   }
   await refresh();
  }finally{setBusy(null);}
 };
 const clear=async()=>{
  if(!window.confirm('Vymazat pouze uložené PID GTFS segmenty z IndexedDB? Dosavadní výsledky testů zůstanou.'))return;
  setBusy('clear');
  try{
   await clearPhase2Cache();
   pidStatic.clearCache();
   setNote('PID IndexedDB byla vymazána. Pro test prvního stažení nyní spusť scénář 1.');
   await refresh();
  }catch(e){setNote('Vymazání se nezdařilo: '+String(e));}
  finally{setBusy(null);}
 };
 const exportReport=()=>{
  const report={schema:'casovac-pid-phase2-check-v1',exportedAt:new Date().toISOString(),
   date,tripId,manifest:manifest?{
    schema:manifest.schema,generatedAt:manifest.generatedAt,
    referenceDay:manifest.referenceDay,days:manifest.days
   }:null,cache,results,
   note:'Údaje se exportují lokálně; neobsahují API token Golemia ani GPS.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='casovac-pid-phase2-'+date+'.json';a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1500);
 };
 const status=pidStatic.getDataStatus();
 const finished=results.filter(x=>x.status==='pass').length;
 return <section className="panel phase2Panel" aria-labelledby="phase2Title">
  <div className="rawSectionHead"><h2 id="phase2Title">Diagnostika PID Static Engine · fáze 2</h2>
   <span className="status">{finished}/{phase2Scenarios.length} PASS</span></div>
  <p className="hint">Pět ověřovacích scénářů pro trvalou cache, dostupnost bez sítě, kontrolu verzí a provozní den.
   Testy používají <strong>provozní den {date}</strong> a trip <code>{tripId||'—'}</code>.
   Zadej trip ID výše nebo načti živý spoj. Běžný Časovač se nemění a Golemio se těmito testy nevolá.</p>
  <div className="phase2Facts">
   <div><small>VERZE GTFS</small><strong>{manifest?.generatedAt?stamp(manifest.generatedAt):'Nedostupná'}</strong></div>
   <div><small>REFERENČNÍ DEN</small><strong>{manifest?.referenceDay??'—'}</strong></div>
   <div><small>ZDROJ MANIFESTU</small><strong>{status.source==='persisted'?'IndexedDB (offline)':status.source==='network'?'Online':'Neznámý'}</strong></div>
   <div><small>INDEXEDDB</small><strong>{cache?.available?'Dostupná':'Nedostupná'}</strong></div>
   <div><small>ULOŽENO</small><strong>{cache?cache.entries+' segmentů · '+formatBytes(cache.bytes):'—'}</strong></div>
   <div><small>KAPACITA</small><strong>{cache?formatBytes(cache.limitBytes)+' · max '+cache.entryLimit:'—'}</strong></div>
  </div>
  {manifest&&<p className="hint">Dostupné provozní dny: {Object.entries(manifest.days).map(([day,item])=>
   day+' ('+(item.available?'✓':'nedostupný')+')').join(' · ')}</p>}
  {manifestError&&<p className="phase2Error">Manifest: {manifestError}</p>}
  <div className="phase2Actions">
   <button className="quiet" disabled={!!busy} onClick={()=>{setBusy('refresh');void refresh().finally(()=>setBusy(null));}}>
    Aktualizovat stav</button>
   <button className="quiet" disabled={!!busy} onClick={()=>void clear()}>Vymazat PID cache</button>
   <button className="primary" disabled={!!busy||!tripId.trim()} onClick={()=>void run(phase2Scenarios.map(x=>x.id))}>
    {busy==='all'?'Testuji…':'Spustit všech 5 testů'}</button>
  </div>
  <p className="hint">Pro měření prvního stažení nejdřív použij „Vymazat PID cache“. Test 3 vypne síť
   <strong> pouze uvnitř testovací instance</strong>; nemusíš vypínat Wi-Fi ani otevírat DevTools.
   Testy 4 a 5 jsou kontrolované simulace, nikoliv skutečná aktualizace PID či změna systémových hodin.</p>
  {note&&<p role="status" className="hint">{note}</p>}
  <div className="phase2Scenarios">
   {phase2Scenarios.map(item=>{
    const result=results.find(x=>x.id===item.id);
    return <div className="phase2Scenario" key={item.id}>
     <div className="phase2ScenarioHead"><div><strong>{item.title}</strong><small>{item.mode==='real'?'SKUTEČNÝ PROVOZ':'SIMULACE'}</small></div>
      <span className={'status '+(result?(result.status==='pass'?'good':'bad'):'')}>
       {result?(result.status==='pass'?'PASS':'FAIL'):'NEPROVEDENO'}</span></div>
     <p>{item.description}</p>
     {result&&<div className="phase2Result">
      <p>{result.detail}</p>
      {result.error&&<p className="phase2Error">{result.error}</p>}
      <small>{result.durationMs} ms · HTTP: {result.requests} · JSON: {formatBytes(result.jsonBytes)}
       {result.id==='restart'?' (nezahrnuje přípravné stažení)':''}</small>
     </div>}
     <button className="quiet" disabled={!!busy||(item.id!=='version'&&item.id!=='midnight'&&!tripId.trim())}
      onClick={()=>void run([item.id])}>{busy===item.id?'Testuji…':'Spustit test'}</button>
    </div>;
   })}
  </div>
  <div className="phase2Actions">
   <button className="quiet" onClick={exportReport} disabled={!results.length||!!busy}>Export protokolu JSON</button>
   <button className="quiet" onClick={()=>setResults([])} disabled={!results.length||!!busy}>Vymazat výsledky</button>
  </div>
  <p className="hint">Hodnota „JSON“ je objem dekódovaných odpovědí v rámci měřeného kroku,
   nikoliv skutečný síťový přenos po kompresi. Test 2 a 3 provádí přípravné načtení mimo tuto metriku.
   Bez Service Workeru nelze garantovat otevření samotné aplikace bez připojení.</p>
 </section>;
}
