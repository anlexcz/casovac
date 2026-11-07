import {useState} from 'react';
import StopNeighbourSheet from './StopNeighbourSheet';
import Diagnostics from './Diagnostics';
import StopBoard from './StopBoard';
import {formatHeadway} from './lineHeadways';
import {chooserStop} from './chooserStops';
import {useAppController,parseOrder,vehicleId} from './useAppController';

type Props=ReturnType<typeof useAppController>;
export default function AppView({neighbourSettings,updateNeighbourSettings,neighbourIndex,setNeighbourIndex,autoNeighbourIndex,autoNeighbourReady,stopNeighbours,showHeadways,setShowHeadways,headways,visualLine,visualOrder,visualDestination,atChainBoundary,token,setToken,rememberToken,setRememberToken,tokenVisible,setTokenVisible,settings,setSettings,query,setQuery,active,diagnostics,setDiagnostics,selectedTrip,manual,setManual,expanded,setExpanded,editing,setEditing,features,lookup,lastFetch,queryMode,lastSeen,relatedVehicle,lastHandoff,terminalCandidates,loading,error,setError,gpsWanted,setGpsWanted,gps,gpsError,gpsAge,pos,toggleGPS,lookupLine,lookupOrder,results,lookupReady,stopNames,start,forget,chooseTrip,matches,chosen,trip,tripId,nextTrip,previousTrip,previousPartner,plannedHandoff,continuity,age,nextStopId,departureDetection,remote,onboard,compatible,position,terminalWaiting,terminalName,displayedIndex,highlightedStop,highlightedRemaining,statusColor,statusDescription,chainDiagnostic,departureEvidence,remoteProgress,recorder}:Props){
 const [dismissedStop,setDismissedStop]=useState('');
 const sheetIndex=neighbourIndex??autoNeighbourIndex;
 const sheetStop=sheetIndex===null?null:trip.stops[sheetIndex]??null;
 const sheetKey=tripId+'|'+(sheetStop?.id??String(sheetIndex??''));
 const hasNearby=(stopNeighbours.result?.rows.length??0)>0;
 const autoOpen=neighbourSettings.enabled&&neighbourSettings.mode!=='off'&&
  neighbourIndex===null&&sheetIndex!==null&&sheetStop!==null&&
  dismissedStop!==sheetKey&&hasNearby&&
  (autoNeighbourIndex===displayedIndex||autoNeighbourReady)&&
  (neighbourSettings.mode==='all'||!!stopNeighbours.result?.significant);
 const sheetOpen=neighbourSettings.enabled&&!diagnostics&&!settings&&
  (neighbourIndex!==null||autoOpen);
 const closeNeighbourSheet=()=>{
  setDismissedStop(sheetKey);
  setNeighbourIndex(null);
 };
 const openStopSheet=(i:number)=>{setNeighbourIndex(i);};
 return <main className="appShell">
  <header className="topbar">
   <div><h1>ČASOVAČ<span className="dot">.</span></h1></div>
   <div className="headActions">
    <button className="headButton" type="button" onClick={()=>{setQuery(active?.[0]??'');setEditing(true);setError('');}} aria-label="Vybrat sledovaný spoj" title="Vybrat sledovaný spoj"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m15 5 4 4M4 20l4.8-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
    <button className={'headButton '+(gpsWanted&&!gpsError&&gpsAge!==null&&gpsAge<=20?'gpsActive':'')} onClick={toggleGPS} aria-pressed={gpsWanted} aria-label={gpsWanted?'Vypnout GPS':'Zapnout GPS'} title={gpsError||pos.status}>⌖ <span>GPS</span></button>
    <a className="headButton rawDebugLink" href={import.meta.env.BASE_URL+'rawdebug/'} title="Syrová online data Golemia" aria-label="Otevřít RAWDEBUG">RAW</a>
    <button className="headButton" onClick={()=>setSettings(true)} aria-label="Nastavení">⚙</button>
   </div>
  </header>

  {!active&&!editing&&<section className="panel searchPanel compactSearch"><button className="primary full" onClick={()=>setEditing(true)}>Vybrat sledovaný spoj</button></section>}
  {editing&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setEditing(false);}}>
   <section className="modal chooserModal" role="dialog" aria-modal="true" aria-label="Vybrat sledovaný spoj">
    <div className="row chooserHeading"><div><h2>Vybrat spoj</h2></div><button className="iconButton" onClick={()=>setEditing(false)} aria-label="Zavřít">✕</button></div>
    <input id="orderInput" autoFocus aria-label="Linka nebo linka/pořadí" placeholder="Např. 25 nebo 25/5" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&parseOrder(query))start();}}/>
    {!token.trim()?<p className="hint">Pro vyhledávání je potřeba API klíč Golemio v nastavení.</p>:
     !lookupLine?<p className="hint">Zadej číslo linky nebo konkrétní pořadí.</p>:
     <div className="chooserResults">
      <p className="chooserCaption">{!lookupReady&&!results.length?'Načítám dostupná pořadí…':lookupOrder?'Výsledek vyhledávání':'LINKA '+lookupLine+' · '+results.length+' POŘADÍ'}</p>
      {lookup.line===lookupLine&&lookup.error&&<p className="hint" role="status">{lookup.error}</p>}
      {lookupReady&&results.map(item=><button type="button" className="chooserRow" key={item.line+'/'+item.order} onClick={()=>start(item.line+'/'+item.order)}>
       <span className="chooserId"><span>{item.line}/</span><strong>{item.order}</strong></span><span className="chooserVehicle">#{item.car}</span><span className="chooserStop"><svg className="chooserStopIcon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="5" y="3" width="14" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M5 10h14M8 7h2m4 0h2M8 19l-2 3m10-3 2 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg><span>{chooserStop(item.target,stopNames)}</span></span>
      </button>)}
      {lookupReady&&!lookup.error&&lookupOrder&&results.length===0&&<div className="chooserMissing"><strong>Pořadí {lookupOrder[0]}/{lookupOrder[1]} není momentálně dostupné.</strong><p className="hint">Můžeš opravit zadání nebo pořadí sledovat a počkat na data.</p><button className="primary full" onClick={()=>start()}>Sledovat {lookupOrder[0]}/{lookupOrder[1]} a čekat na data</button></div>}
      {lookupReady&&!lookup.error&&!lookupOrder&&results.length===0&&<p className="hint">Aktuálně nejsou dostupná žádná pořadí. Konkrétní pořadí můžeš zadat ručně.</p>}
     </div>}
   </section>
  </div>}
  {error&&<div className="alert" role="status">{error}</div>}
  {active&&<section className="panel journeyPanel compactJourney">
    <div className="compactIdentity">
      <div className={'serviceBadge '+(visualLine.length>=3?'serviceBadgeThree':'')} aria-label={'Linka '+visualLine+', pořadí '+visualOrder}>
       <div className="routeTile">{visualLine}</div>
       <div className={'orderTile '+(visualOrder.length>=2?'orderTileTwo':'')}>{visualOrder}</div>
      </div>
      <div className="identityDetails">
       <div className="routeDirection">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="identityIcon"><path d="M4 12h16m-7-7 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>{visualDestination}</span>
       </div>
       <div className="vehicleNumber">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="identityIcon"><rect x="5" y="3.5" width="14" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.9"/><path d="M5 11h14M8 7.5h2m4 0h2M8 18.5l-2 3m10-3 2 3M9 21h6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>
        <span>#{chosen?vehicleId(chosen):lastSeen?.vehicle??'—'}</span>
       </div>
       {showHeadways&&(headways?.aheadSeconds!==null&&headways?.aheadSeconds!==undefined||
         headways?.behindSeconds!==null&&headways?.behindSeconds!==undefined)&&
        <div className="compactHeadways" aria-label="Časové rozestupy plánovaně sousedních spojů">
         {headways?.aheadSeconds!==null&&headways?.aheadSeconds!==undefined&&
          <span title="Předchozí spoj na společné části trasy" className="headwayValue">
           <span aria-hidden="true">↑</span><span>{formatHeadway(headways.aheadSeconds)}</span>{headways.ahead&&<span className="headwayBadge">{headways.ahead.line}/{headways.ahead.order||'?'}</span>}
          </span>}
         {headways?.behindSeconds!==null&&headways?.behindSeconds!==undefined&&
          <span title="Následující spoj na společné části trasy" className="headwayValue">
           <span aria-hidden="true">↓</span><span>{formatHeadway(headways.behindSeconds)}</span>{headways.behind&&<span className="headwayBadge">{headways.behind.line}/{headways.behind.order||'?'}</span>}
          </span>}
        </div>}
      </div>
      <button className={'vehicleStatus '+statusColor} type="button" onClick={()=>setDiagnostics(true)}
       aria-label={statusDescription+'; otevřít diagnostiku'} title={statusDescription}>
       <span className="statusDot"/>
      </button>
    </div>
    {highlightedStop&&displayedIndex!==null?
     <StopBoard stops={trip.stops} index={displayedIndex} tripId={tripId} remaining={highlightedRemaining}
      terminalWaiting={terminalWaiting} expanded={expanded} onExpand={()=>setExpanded(v=>!v)}
      onOpenStop={openStopSheet} animate={manual===null&&!diagnostics}
      activeLine={active[0]} visualBoundary={atChainBoundary}

      continuation={continuity.ok&&plannedHandoff&&nextTrip.tripId===plannedHandoff.next.tripId?
       {line:plannedHandoff.next.line,order:plannedHandoff.next.order,stops:nextTrip.stops}:null}
      predecessor={continuity.ok&&previousPartner&&previousTrip.tripId===previousPartner.tripId?
       {line:previousPartner.line,order:previousPartner.order,stops:previousTrip.stops}:null}/>
     :<div className="compactEmpty">
       {loading||trip.loading?'Načítání…':chosen?trip.error||'Jízdní řád nedostupný':lastSeen?
       'Poslední vůz #'+lastSeen.vehicle+' · '+new Date(lastSeen.lastSeenAt).toLocaleTimeString('cs-CZ'):error?'Data jsou dočasně nedostupná':'Pořadí nenalezeno'}
      </div>}
  </section>}
  {active&&<StopNeighbourSheet open={sheetOpen}
   name={sheetStop?.name??''} platformCode={sheetStop?.platformCode??''}
   data={stopNeighbours.result} loading={stopNeighbours.loading} error={stopNeighbours.error}
   ownLine={visualLine} ownOrder={visualOrder}
   ownVehicle={chosen?vehicleId(chosen):lastSeen?.vehicle??''}
   onClose={closeNeighbourSheet}/>}
  {!active&&<section className="panel emptyWelcome"><h2>Připraveno ke sledování</h2><p>Vyplň linku a pořadí. Časovač potom načte živé vozidlo a jízdní řád bez stahování GTFS souborů.</p></section>}

  <div className={diagnostics?'diagnosticVisible':'diagnosticHidden'}><div className="diagHeading"><h2>Diagnostika</h2><button onClick={()=>setDiagnostics(false)} className="quiet">Zavřít</button></div>
   {showHeadways&&<section className="panel" aria-label="Diagnostika rozestupů spojů">
    <h3>Výběr sousedních spojů</h3>
    <p className="hint">Rozhoduje plánovaný jízdní řád a společný úsek. Diagnostika zobrazuje pouze kandidáty s dostupnou čerstvou telemetrií.</p>
    <p className="hint">Předchozí: {headways?.ahead?headways.ahead.line+'/'+headways.ahead.order:'—'} · Následující: {headways?.behind?headways.behind.line+'/'+headways.behind.order:'—'}</p>
    {headways?.decisions.length?<details><summary>Kandidáti a důvody ({headways.decisions.length})</summary>
      <ul>{headways.decisions.map((decision,i)=><li key={decision.tripId+'-'+i}>{decision.line}/{decision.order||'?'} · {decision.reason}{decision.direction?' ('+(decision.direction==='ahead'?'před':'za')+')':''}</li>)}</ul>
    </details>:<p className="hint">Žádní vhodní kandidáti s dostupnými daty.</p>}
   </section>}
   <Diagnostics active={active} features={features} chosen={chosen??null} trip={trip} gps={gps} gpsError={gpsError} gpsWanted={gpsWanted} gpsAge={gpsAge} age={age} lastFetch={lastFetch} error={error} matchingCount={matches.length} position={position} positionState={pos.status} vehicleDistance={pos.vehicleDistance} manual={manual} setManual={setManual} selectedTrip={selectedTrip} setSelectedTrip={chooseTrip} startGps={()=>setGpsWanted(true)} stopGps={()=>setGpsWanted(false)} nextStopId={nextStopId} departure={departureDetection} remote={remote} onboard={compatible} onboardDecision={onboard} terminalWaiting={terminalWaiting} terminalName={terminalName} queryMode={queryMode} terminalCandidates={terminalCandidates} remoteProgress={remoteProgress} lastSeen={lastSeen} relatedVehicle={relatedVehicle} chainDiagnostic={chainDiagnostic} lastHandoff={lastHandoff} plannedHandoff={plannedHandoff?.next??null} handoffContinuity={continuity.reason} handoffDeparture={departureEvidence.reason} recorder={recorder}/>
  </div>

  <button className="debugFab" onClick={()=>setDiagnostics(v=>!v)} aria-label={diagnostics?'Zavřít diagnostiku':'Otevřít diagnostiku'} title="Diagnostika">{diagnostics?'×':'⌘'}</button>

  {settings&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false);}}>
   <div className="modal" role="dialog" aria-modal="true" aria-label="Nastavení">
    <div className="row"><h2>Nastavení</h2><button className="iconButton" onClick={()=>setSettings(false)} aria-label="Zavřít">✕</button></div>
    <label htmlFor="token">GOLEMIO API KLÍČ</label>
    <div className="search"><input id="token" type={tokenVisible?'text':'password'} value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="X-Access-Token"/><button onClick={()=>setTokenVisible(v=>!v)}>{tokenVisible?'Skrýt':'Ukázat'}</button></div>
    <label className="rememberOption"><input type="checkbox" checked={rememberToken} onChange={e=>setRememberToken(e.target.checked)}/><span>Zapamatovat klíč v tomto prohlížeči</span></label>
    <p className="hint">Při zapamatování se token uloží nešifrovaně v localStorage tohoto prohlížeče. Neukládá se na GitHub ani do URL; čtou ho však skripty stránky a může být dostupný rozšířením.</p>
    <div className="settingsSectionHeading">Zobrazení</div>
    <label className="rememberOption"><input type="checkbox" checked={showHeadways} onChange={e=>setShowHeadways(e.target.checked)}/><span>Zobrazovat rozestupy spojů</span></label>
    <p className="hint">Malé údaje ↑ předchozí a ↓ následující spoj. Pouze při spolehlivých živých datech a na společné části trasy. Nastavení se ukládá v tomto prohlížeči.</p>
    <div className="settingsSectionHeading">Okolní spoje na stejné nástupní hraně</div>
    <label className="rememberOption"><input type="checkbox" checked={neighbourSettings.enabled}
     onChange={e=>updateNeighbourSettings({enabled:e.target.checked})}/>
     <span>Zobrazovat okolní spoje u zastávek</span></label>
    <label htmlFor="neighbourLead">Automaticky otevřít před příjezdem (sekundy)</label>
    <input id="neighbourLead" type="number" min="30" max="180" step="10"
     value={neighbourSettings.autoOpenSeconds}
     onChange={e=>updateNeighbourSettings({autoOpenSeconds:Math.max(30,Math.min(180,Number(e.target.value)||90))})}/>
    <label htmlFor="neighbourAuto">Automatické rozbalení</label>
    <select id="neighbourAuto" value={neighbourSettings.mode}
     onChange={e=>updateNeighbourSettings({mode:e.target.value as typeof neighbourSettings.mode})}>
     <option value="off">Vypnuto, pouze ručně</option>
     <option value="important">Jen významné zastávky</option>
     <option value="all">Všechny zastávky s blízkými spoji</option>
    </select>
    <label htmlFor="neighbourWindow">Časové okno</label>
    <select id="neighbourWindow" value={neighbourSettings.window}
     onChange={e=>updateNeighbourSettings({window:e.target.value as typeof neighbourSettings.window})}>
     <option value="auto">Automatické podle vzdálenosti</option>
     <option value="manual">Vlastní</option>
    </select>
    {neighbourSettings.window==='manual'&&<div className="neighbourSettingsGrid">
     <label>Před příjezdem (min)
      <input type="number" min="0" max="20" step="1" value={neighbourSettings.beforeMinutes}
       onChange={e=>updateNeighbourSettings({beforeMinutes:Math.max(0,Math.min(20,Number(e.target.value)||0))})}/>
     </label>
     <label>Po příjezdu (min)
      <input type="number" min="0" max="20" step="1" value={neighbourSettings.afterMinutes}
       onChange={e=>updateNeighbourSettings({afterMinutes:Math.max(0,Math.min(20,Number(e.target.value)||0))})}/>
     </label>
    </div>}
    <label htmlFor="neighbourLookahead">Ruční zobrazení: kolik zastávek dopředu</label>
    <input id="neighbourLookahead" type="number" min="1" max="10" step="1"
     value={neighbourSettings.lookahead} onChange={e=>updateNeighbourSettings({
      lookahead:Math.max(1,Math.min(10,Number(e.target.value)||1))
     })}/>
    <p className="hint">Spoje se filtrují podle očekávaného příjezdu, ale řadí výhradně podle JŘ. Používá se přesné ID nástupní hrany. Aktualizace nevyžaduje restart sledování.</p>
    <button className="quiet full" disabled={!token} onClick={forget}>Zapomenout API klíč</button>
    <button className="primary full" onClick={()=>setSettings(false)}>Hotovo</button>
   </div>
  </div>}
 </main>;
}
