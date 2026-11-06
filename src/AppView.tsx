import Diagnostics from './Diagnostics';
import StopBoard from './StopBoard';
import {chooserStop} from './chooserStops';
import {useAppController,parseOrder,vehicleId} from './useAppController';

type Props=ReturnType<typeof useAppController>;
export default function AppView({token,setToken,rememberToken,setRememberToken,tokenVisible,setTokenVisible,settings,setSettings,query,setQuery,active,diagnostics,setDiagnostics,selectedTrip,manual,setManual,expanded,setExpanded,editing,setEditing,features,lookup,lastFetch,queryMode,lastSeen,relatedVehicle,lastHandoff,terminalCandidates,loading,error,setError,gpsWanted,setGpsWanted,gps,gpsError,gpsAge,pos,toggleGPS,lookupLine,lookupOrder,results,lookupReady,stopNames,start,forget,chooseTrip,matches,chosen,trip,tripId,nextTrip,plannedHandoff,continuity,age,nextStopId,departureDetection,remote,onboard,compatible,position,destination,terminalWaiting,terminalName,displayedIndex,highlightedStop,highlightedRemaining,statusColor,statusDescription,chainDiagnostic,departureEvidence,remoteProgress,recorder}:Props){
 return <main className="appShell">
  <header className="topbar">
   <div><h1>ČASOVAČ<span className="dot">.</span></h1></div>
   <div className="headActions">
    <button className="headButton" type="button" onClick={()=>{setQuery(active?.[0]??'');setEditing(true);setError('');}} aria-label="Vybrat sledovaný spoj" title="Vybrat sledovaný spoj"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m15 5 4 4M4 20l4.8-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
    <button className={'headButton '+(gpsWanted&&!gpsError&&gpsAge!==null&&gpsAge<=20?'gpsActive':'')} onClick={toggleGPS} aria-pressed={gpsWanted} aria-label={gpsWanted?'Vypnout GPS':'Zapnout GPS'} title={gpsError||pos.status}>⌖ <span>GPS</span></button>
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
      <div className={'serviceBadge '+(active[0].length>=3?'serviceBadgeThree':'')} aria-label={'Linka '+active[0]+', pořadí '+active[1]}>
       <div className="routeTile">{active[0]}</div>
       <div className={'orderTile '+(active[1].length>=2?'orderTileTwo':'')}>{active[1]}</div>
      </div>
      <div className="identityDetails">
       <div className="routeDirection">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="identityIcon"><path d="M4 12h16m-7-7 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>{destination}</span>
       </div>
       <div className="vehicleNumber">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="identityIcon"><rect x="5" y="3.5" width="14" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.9"/><path d="M5 11h14M8 7.5h2m4 0h2M8 18.5l-2 3m10-3 2 3M9 21h6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>
        <span>#{chosen?vehicleId(chosen):lastSeen?.vehicle??'—'}</span>
       </div>
      </div>
      <button className={'vehicleStatus '+statusColor} type="button" onClick={()=>setDiagnostics(true)}
       aria-label={statusDescription+'; otevřít diagnostiku'} title={statusDescription}>
       <span className="statusDot"/>
      </button>
    </div>
    {active&&['5','6','9','10'].includes(active[0])&&displayedIndex!==null&&
      trip.stops.length>0&&trip.stops.length-displayedIndex<=5&&
      <div className={'chainNotice '+(continuity.ok&&plannedHandoff&&
       nextTrip.tripId===plannedHandoff.next.tripId?'chainNoticeReady':'chainNoticePending')}
       role="status">
       <span className="chainNoticeArrow" aria-hidden="true">↳</span>
       <span>{plannedHandoff?
        continuity.ok&&nextTrip.tripId===plannedHandoff.next.tripId?
         'Navazuje linka '+plannedHandoff.next.line+'/'+plannedHandoff.next.order+' · jízdní řád ověřen':
         'Prověřuji návaznost '+plannedHandoff.next.line+'/'+plannedHandoff.next.order:
        'Pokračování linkou '+({'5':'6','6':'5','9':'10','10':'9'} as Record<string,string>)[active[0]]+' zatím nepotvrzeno'}</span>
      </div>}
    {highlightedStop&&displayedIndex!==null?
     <StopBoard stops={trip.stops} index={displayedIndex} tripId={tripId} remaining={highlightedRemaining}
      terminalWaiting={terminalWaiting} expanded={expanded} onExpand={()=>setExpanded(v=>!v)}
      onChoose={index=>setManual(index)} animate={manual===null&&!diagnostics}
      continuation={continuity.ok&&plannedHandoff&&nextTrip.tripId===plannedHandoff.next.tripId?
       {line:plannedHandoff.next.line,order:plannedHandoff.next.order,stops:nextTrip.stops}:null}/>
     :<div className="compactEmpty">
       {loading||trip.loading?'Načítání…':chosen?trip.error||'Jízdní řád nedostupný':lastSeen?
       'Poslední vůz #'+lastSeen.vehicle+' · '+new Date(lastSeen.lastSeenAt).toLocaleTimeString('cs-CZ'):error?'Data jsou dočasně nedostupná':'Pořadí nenalezeno'}
      </div>}
  </section>}
  {!active&&<section className="panel emptyWelcome"><h2>Připraveno ke sledování</h2><p>Vyplň linku a pořadí. Časovač potom načte živé vozidlo a jízdní řád bez stahování GTFS souborů.</p></section>}

  <div className={diagnostics?'diagnosticVisible':'diagnosticHidden'}><div className="diagHeading"><h2>Diagnostika</h2><button onClick={()=>setDiagnostics(false)} className="quiet">Zavřít</button></div>
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
    <button className="quiet full" disabled={!token} onClick={forget}>Zapomenout API klíč</button>
    <button className="primary full" onClick={()=>setSettings(false)}>Hotovo</button>
   </div>
  </div>}
 </main>;
}
