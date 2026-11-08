import {useEffect,useState} from 'react';
import {useNeighbourIdleTimeout} from './useNeighbourIdleTimeout';
import StopNeighbourSheet from './StopNeighbourSheet';
import Diagnostics from './Diagnostics';
import StopBoard from './StopBoard';
import {formatHeadway} from './lineHeadways';
import HeadwayDetails from './HeadwayDetails.tsx';
import {chooserStop} from './chooserStops';
import {useAppController,vehicleId} from './useAppController';
import {OWN_VEHICLE_POLL_MS,OWN_VEHICLE_RETAIN_MS} from './pollingCadence.ts';
import {neighbourStopIdentity,neighbourResultMatchesStop} from './neighbourStopIdentity';
import {onlyPreviouslySharedPeers} from './autoNeighbourNovelty.ts';
import {downloadNetworkAudit,clearNetworkAudit,getNetworkAuditScenario,setNetworkAuditScenario} from './networkAudit.ts';

type Props=ReturnType<typeof useAppController>;
export default function AppView({trackedService,coreTracking,neighbourSettings,updateNeighbourSettings,neighbourIndex,setNeighbourIndex,autoNeighbourIndex,autoNeighbourReady,autoTargetIndex,autoPlatformMarkers,autoPhysicalStopMap,autoTransfer,pinnedStillActive,pinnedAutoNeighbour,setPinnedAutoNeighbour,stopNeighbours,showHeadways,setShowHeadways,submitLookup,resetLookup,lookupConfirmed,plannedHeadways,plannedLiveHeadways,peerFeatures,peerTripIds,peerPositionLoading,peerPhases,peerReasons,peerLastKnown,peerDutyIds,ownHeadwayDutyId,planDate,now,peerPositionStatus,visualLine,visualOrder,visualDestination,atChainBoundary,token,setToken,rememberToken,setRememberToken,tokenVisible,setTokenVisible,settings,setSettings,query,setQuery,active,diagnostics,setDiagnostics,selectedTrip,manual,setManual,expanded,setExpanded,editing,setEditing,features,lookup,lastFetch,queryMode,lastSeen,relatedVehicle,lastHandoff,terminalCandidates,loading,error,setError,gpsWanted,setGpsWanted,gps,gpsError,gpsAge,pos,toggleGPS,lookupLine,lookupOrder,queryKind,queryVehicle,results,lookupReady,searchingAcrossRoutes,stopNames,start,forget,chooseTrip,matches,chosen,trip,tripId,nextTrip,previousTrip,previousPartner,plannedHandoff,continuity,age,nextStopId,departureDetection,remote,onboard,compatible,position,terminalWaiting,terminalName,displayedIndex,highlightedStop,highlightedRemaining,statusColor,statusDescription,chainDiagnostic,departureEvidence,remoteProgress,recorder}:Props){
 const [dismissedStop,setDismissedStop]=useState('');
 const refreshAge=lastFetch===null?null:Math.max(0,now-lastFetch);
 const refreshPercent=refreshAge===null?4:Math.max(4,Math.min(100,refreshAge/OWN_VEHICLE_POLL_MS*100));
 const refreshState=error||refreshAge!==null&&refreshAge>OWN_VEHICLE_RETAIN_MS?'error':
  loading||peerPositionLoading?'loading':refreshAge!==null&&refreshAge>OWN_VEHICLE_POLL_MS*2?'stale':'ok';
 const plannedReady=plannedHeadways.data.status==='ready';
 const front=plannedReady?plannedHeadways.data.ahead:null;
 const rear=plannedReady?plannedHeadways.data.behind:null;
 const frontLive=plannedReady?plannedLiveHeadways.ahead?.seconds??null:null;
 const rearLive=plannedReady?plannedLiveHeadways.behind?.seconds??null:null;
 // Mobile keyboards change the visual viewport without necessarily changing
 // 100dvh. Keep the chooser anchored to the actual visible viewport.
 const [chooserViewport,setChooserViewport]=useState<{height:number;top:number}|null>(null);
 useEffect(()=>{
  if(!editing)return;
  const viewport=window.visualViewport;
  if(!viewport)return;
  const update=()=>setChooserViewport({height:viewport.height,top:viewport.offsetTop});
  update();
  viewport.addEventListener('resize',update);
  viewport.addEventListener('scroll',update);
  return()=>{
   viewport.removeEventListener('resize',update);
   viewport.removeEventListener('scroll',update);
  };
 },[editing]);
 const sheetIndex=neighbourIndex??autoNeighbourIndex;
 const sheetStop=sheetIndex===null?null:trip.stops[sheetIndex]??null;
 const sheetKey=neighbourStopIdentity(tripId,sheetIndex,sheetStop);
 const verifiedNeighbourData=neighbourResultMatchesStop(stopNeighbours.result,
  sheetStop&&stopNeighbours.gate.selectedStopId?{...sheetStop,id:stopNeighbours.gate.selectedStopId}:sheetStop)?stopNeighbours.result:null;
 // Open only on precomputed, verified physical boarding edges. An empty
 // completed board is informative; no near-by departure is NOT a trigger
 // on an ordinary (unmarked) stop. LIVE losses never unpin an open sheet.
 // The automatic mode should not repeat peers already encountered on the
 // preceding boarding edge. Wait for a complete, stop-matched board so a
 // transient partial refresh never opens a panel that should stay closed.
 // Manual tapping bypasses this filter entirely.
 const repeatedOnly=onlyPreviouslySharedPeers(
  verifiedNeighbourData,
  autoTargetIndex===null?undefined:trip.stops[autoTargetIndex-1],
  autoPhysicalStopMap
 );
 const pinnedActive=!!pinnedAutoNeighbour&&pinnedStillActive;
 const eligibleAuto=neighbourSettings.enabled&&neighbourSettings.mode!=='off'&&
  neighbourIndex===null&&autoNeighbourReady&&autoTargetIndex!==null&&
  sheetIndex===autoTargetIndex&&sheetStop!==null&&dismissedStop!==sheetKey&&
  stopNeighbours.complete&&!!verifiedNeighbourData&&!repeatedOnly;
 const autoOpen=neighbourIndex===null&&dismissedStop!==sheetKey&&
  (pinnedActive||eligibleAuto);
 const sheetOpen=neighbourSettings.enabled&&!diagnostics&&!settings&&
  (neighbourIndex!==null||autoOpen);
 useEffect(()=>{
  if(!eligibleAuto||sheetIndex===null||neighbourIndex!==null)return;
  if(pinnedActive&&!autoTransfer)return;
  setPinnedAutoNeighbour({tripId,index:sheetIndex});
 },[eligibleAuto,sheetIndex,neighbourIndex,tripId,pinnedActive,autoTransfer,setPinnedAutoNeighbour]);
 useEffect(()=>{
  // Only verified departure beyond the target (or a changed trip) ends it;
  // a predicted display index, delayed API refresh or lost LIVE cannot.
  if(!pinnedAutoNeighbour||pinnedStillActive)return;
  setPinnedAutoNeighbour(null);
 },[pinnedAutoNeighbour,pinnedStillActive,setPinnedAutoNeighbour]);
 const closeNeighbourSheet=()=>{
  setDismissedStop(sheetKey);
  setNeighbourIndex(null);
  setPinnedAutoNeighbour(null);
 };
 const openStopSheet=(i:number)=>{setNeighbourIndex(i);};
 const manualSheet=neighbourSettings.enabled&&neighbourIndex!==null&&!settings&&!diagnostics;
 const manualIdle=useNeighbourIdleTimeout(
  manualSheet,tripId+'|'+String(neighbourIndex),neighbourSettings.manualCloseSeconds,
  closeNeighbourSheet
 );
 return <main className="appShell">
  <header className="topbar">
   <div><h1>ČASOVAČ<span className="dot">.</span></h1></div>
   <div className="headActions">
    <button className="headButton" type="button" onClick={()=>{resetLookup();setQuery(active?.[0]??'');setEditing(true);setError('');}} aria-label="Vybrat sledovaný spoj" title="Vybrat sledovaný spoj"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m15 5 4 4M4 20l4.8-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
    <button className={'headButton '+(gpsWanted&&!gpsError&&gpsAge!==null&&gpsAge<=20?'gpsActive':'')} onClick={toggleGPS} aria-pressed={gpsWanted} aria-label={gpsWanted?'Vypnout GPS':'Zapnout GPS'} title={gpsError||pos.status}>⌖ <span>GPS</span></button>
    <a className="headButton rawDebugLink" href={import.meta.env.BASE_URL+'rawdebug/'} title="Syrová online data Golemia" aria-label="Otevřít RAWDEBUG">RAW</a>
    <button className="headButton" onClick={()=>setSettings(true)} aria-label="Nastavení">⚙</button>
   </div>
   {active&&<div className={'refreshTrack refreshTrack-'+refreshState}
    title="Obnova živých dat" role="progressbar" aria-label="Průběh obnovy živých dat"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(refreshPercent)}>
    <span className="refreshTrackFill" style={{width:refreshPercent+'%'}}/>
   </div>}
  </header>

  {!active&&!editing&&<section className="panel searchPanel compactSearch"><button className="primary full" onClick={()=>{resetLookup();setEditing(true);}}>Vybrat sledovaný spoj</button></section>}
  {editing&&<div className="overlay chooserOverlay"
   style={chooserViewport?{height:chooserViewport.height,top:chooserViewport.top}:undefined}
   onMouseDown={e=>{if(e.target===e.currentTarget)setEditing(false);}}>
   <section className="modal chooserModal" role="dialog" aria-modal="true" aria-label="Vybrat sledovaný spoj">
    <div className="row chooserHeading"><div><h2>Vybrat spoj</h2></div><button className="iconButton" onClick={()=>setEditing(false)} aria-label="Zavřít">✕</button></div>
    <input id="orderInput" autoFocus aria-label="Linka, pořadí nebo evidenční číslo" placeholder="Např. 7, 91/71 nebo #8266" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){
      if(lookupConfirmed&&lookupReady&&!searchingAcrossRoutes&&results.length===1&&!results[0].ambiguous)start(results[0].line+'/'+results[0].order);
      else submitLookup();
     }}}/>
    <button className="quiet" type="button" disabled={!token.trim()||!query.trim()}
     onClick={submitLookup}>Vyhledat</button>
    <p className="chooserCaption" role="status" aria-live="polite">
     {!token.trim()?'API KLÍČ NENÍ ZADANÝ':
      !lookupConfirmed?'POTVRĎ ENTER NEBO TLAČÍTKEM VYHLEDAT':
      queryKind==='invalid'?'ZADEJ LINKU, POŘADÍ NEBO # VOZU':
      !lookupReady&&!results.length?'NAČÍTÁM DOSTUPNÁ POŘADÍ…':
      queryKind==='vehicle'?'VOZIDLO #'+queryVehicle+' · '+results.length+' VÝSLEDKŮ':
      lookupOrder?'POŘADÍ '+lookupOrder[0]+'/'+lookupOrder[1]+' · '+results.length+' VÝSLEDKŮ':
      'LINKA '+lookupLine+' · '+results.length+' POŘADÍ'}
    </p>
    <div className="chooserResults">
     {!token.trim()?<p className="hint">Pro vyhledávání je potřeba API klíč Golemio v nastavení.</p>:
      !lookupConfirmed?<p className="hint">Vyhledávání se spustí až po potvrzení, během psaní neposílá LIVE dotazy.</p>:
      queryKind==='invalid'?<p className="hint">Zadej linku, aktuální či kmenové pořadí nebo #evidenční číslo.</p>:<>
       {searchingAcrossRoutes&&<p className="hint" role="status">Dohledávám také kmenová pořadí na ostatních linkách…</p>}
       {lookup.error&&<p className="hint" role="status">{lookup.error}</p>}
       {lookupReady&&results.map(item=><button type="button" className="chooserRow" key={item.line+'/'+item.order} disabled={item.ambiguous} title={item.ambiguous?'Nejednoznačné přiřazení vozu; vyber až po ověření':undefined} onClick={()=>start(item.line+'/'+item.order)}>
        <span className="chooserId"><span>{item.line}/</span><strong>{item.order}</strong>
         {item.originRoute&&item.originRoute!==item.line&&<span className="chooserOrigin">({item.originRoute}/{item.order})</span>}
        </span><span className="chooserVehicle">{item.ambiguous?'Nejednoznačné':item.car!=='—'?'#'+item.car:'—'}</span><span className="chooserStop"><svg className="chooserStopIcon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="5" y="3" width="14" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M5 10h14M8 7h2m4 0h2M8 19l-2 3m10-3 2 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg><span>{chooserStop(item.target,stopNames)}</span></span>
       </button>)}
       {lookupReady&&!lookup.error&&!searchingAcrossRoutes&&lookupOrder&&results.length===0&&
        <div className="chooserMissing"><strong>Pro zadání {lookupOrder[0]}/{lookupOrder[1]} nebylo nalezeno pořadí.</strong>
         <p className="hint">Hledají se i delší pořadí začínající zadanými číslicemi a kmenová pořadí napříč linkami. Bez ověření nenabízíme sledování jiné linky.</p>
        </div>}
       {lookupReady&&!lookup.error&&queryKind==='vehicle'&&!searchingAcrossRoutes&&results.length===0&&<p className="hint">Vozidlo #{queryVehicle} není v dostupných datech Golemia.</p>}
       {lookupReady&&!lookup.error&&queryKind==='route'&&results.length===0&&<p className="hint">Aktuálně nejsou dostupná žádná pořadí. Konkrétní pořadí můžeš zadat ručně.</p>}
      </>}
    </div>
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
       {showHeadways&&<HeadwayDetails planned={plannedHeadways.data}
        loading={plannedHeadways.loading} live={plannedLiveHeadways}
        features={peerFeatures} selected={chosen??null}
        date={planDate} now={now} tripId={tripId} peerTripIds={peerTripIds}
         ownDutyId={ownHeadwayDutyId} peerDutyIds={peerDutyIds}
        phases={peerPhases} peerStatus={peerPositionStatus}/>}

      </div>
      <button className={'vehicleStatus '+statusColor} type="button" onClick={()=>setDiagnostics(true)}
       aria-label={statusDescription+'; otevřít diagnostiku'} title={statusDescription}>
       <span className="statusDot"/>
      </button>
    </div>
    {highlightedStop&&displayedIndex!==null?
     <StopBoard stops={trip.stops} index={displayedIndex} tripId={tripId} remaining={highlightedRemaining} connectionMarkers={autoPlatformMarkers}
      terminalWaiting={terminalWaiting} expanded={expanded} onExpand={()=>setExpanded(v=>!v)}
      onOpenStop={openStopSheet} onChoose={index=>setManual(index)} animate={manual===null&&!diagnostics}
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
   stopKey={sheetKey} name={sheetStop?.name??''} platformCode={stopNeighbours.gate.selectedPlatformCode||sheetStop?.platformCode||''}
   data={verifiedNeighbourData} updatedAt={verifiedNeighbourData?stopNeighbours.updatedAt:0}
   colourOrder={neighbourSettings.colourOrder} tolerance={neighbourSettings.orderToleranceSeconds}
   hysteresis={neighbourSettings.orderHysteresisSeconds}
   loading={stopNeighbours.loading||autoOpen&&!verifiedNeighbourData} error={stopNeighbours.error}
   liveIncomplete={stopNeighbours.liveIncomplete}
   ownLine={visualLine} ownOrder={visualOrder}
   ownVehicle={chosen?vehicleId(chosen):lastSeen?.vehicle??''}
   remainingSeconds={manualSheet?manualIdle.remaining:null}
   countdownTotalSeconds={neighbourSettings.manualCloseSeconds}
   onInteraction={manualIdle.reset}
   onClose={closeNeighbourSheet}/>}
  {!active&&<section className="panel emptyWelcome"><h2>Připraveno ke sledování</h2><p>Vyplň linku a pořadí. Časovač potom načte živé vozidlo a jízdní řád bez stahování GTFS souborů.</p></section>}

  <div className={diagnostics?'diagnosticVisible':'diagnosticHidden'}><div className="diagHeading"><h2>Diagnostika</h2><button onClick={()=>setDiagnostics(false)} className="quiet">Zavřít</button></div>
   {showHeadways&&<section className="panel" aria-label="Diagnostika rozestupů spojů">
    <h3>Výběr sousedních spojů</h3>
    <p className="hint">Rozhoduje plánovaný jízdní řád a společný úsek. Diagnostika zobrazuje pouze kandidáty s dostupnou čerstvou telemetrií.</p>
    <p className="hint">PID plán: {plannedHeadways.loading?'Načítám':plannedHeadways.data.reason} · před: {front?.tripId??'—'} · za: {rear?.tripId??'—'}</p>
    <p className="hint">Skutečný odstup: před {frontLive===null?'nedostupný':formatHeadway(frontLive)} · za {rearLive===null?'nedostupný':formatHeadway(rearLive)}. Přeškrtnuté kolečko značí neověřený odhad podle PID GTFS a tvého potvrzeného zpoždění; signál znamená ověřené LIVE souseda.</p>
    <p className="hint">Zdroj LIVE před: {peerPositionStatus.ahead==='existing'?'společný snapshot linky':peerPositionStatus.ahead==='direct'?'přímý dotaz podle trip ID':peerPositionStatus.ahead==='none'?'bez plánovaného souseda':'nenalezeno'} · za: {peerPositionStatus.behind==='existing'?'společný snapshot linky':peerPositionStatus.behind==='direct'?'přímý dotaz podle trip ID':peerPositionStatus.behind==='none'?'bez plánovaného souseda':'nenalezeno'}.</p>
    <p className="hint">Výběr před/za: pouze PID GTFS na společné trase, včetně ověřených návazností block_id. LIVE se přiřazuje výhradně přes přesné trip ID, bez procházení ostatních vozidel.</p>
   </section>}
   <Diagnostics trackedService={trackedService} coreTracking={coreTracking} active={active} features={features} chosen={chosen??null} trip={trip} gps={gps} gpsError={gpsError} gpsWanted={gpsWanted} gpsAge={gpsAge} age={age} lastFetch={lastFetch} error={error} matchingCount={matches.length} position={position} positionState={pos.status} vehicleDistance={pos.vehicleDistance} manual={manual} setManual={setManual} selectedTrip={selectedTrip} setSelectedTrip={chooseTrip} startGps={()=>setGpsWanted(true)} stopGps={()=>setGpsWanted(false)} nextStopId={nextStopId} departure={departureDetection} remote={remote} onboard={compatible} onboardDecision={onboard} terminalWaiting={terminalWaiting} terminalName={terminalName} queryMode={queryMode} terminalCandidates={terminalCandidates} remoteProgress={remoteProgress} lastSeen={lastSeen} relatedVehicle={relatedVehicle} chainDiagnostic={chainDiagnostic} lastHandoff={lastHandoff} plannedHandoff={plannedHandoff?.next??null} handoffContinuity={continuity.reason} handoffDeparture={departureEvidence.reason} recorder={recorder} neighbourGate={stopNeighbours.gate} probeNeighbourBoard={stopNeighbours.probeDepartureBoard}
   peerPositionStatus={peerPositionStatus} peerPhases={peerPhases}
   peerReasons={peerReasons} peerLastKnown={peerLastKnown}/>
  </div>

  <button className="debugFab" hidden={sheetOpen&&!diagnostics} onClick={()=>setDiagnostics(v=>!v)} aria-label={diagnostics?'Zavřít diagnostiku':'Otevřít diagnostiku'} title="Diagnostika">{diagnostics?'×':'⌘'}</button>

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
    <label htmlFor="neighbourLead">Automaticky otevřít před předchozí zastávkou (sekundy)</label>
    <input id="neighbourLead" type="number" min="30" max="180" step="10"
     value={neighbourSettings.autoOpenSeconds}
     onChange={e=>updateNeighbourSettings({autoOpenSeconds:Math.max(30,Math.min(180,Number(e.target.value)||90))})}/>
    <label htmlFor="neighbourManualTimeout">Automaticky zavřít ručně otevřený panel</label>
    <select id="neighbourManualTimeout" value={neighbourSettings.manualCloseSeconds}
     onChange={e=>updateNeighbourSettings({manualCloseSeconds:Number(e.target.value)})}>
     <option value={0}>Nikdy</option>
     <option value={15}>Po 15 sekundách</option>
     <option value={30}>Po 30 sekundách</option>
     <option value={45}>Po 45 sekundách</option>
     <option value={60}>Po 60 sekundách</option>
     <option value={90}>Po 90 sekundách</option>
     <option value={120}>Po 120 sekundách</option>
     <option value={180}>Po 180 sekundách</option>
    </select>
    <label htmlFor="neighbourAuto">Automatické rozbalení</label>
    <select id="neighbourAuto" value={neighbourSettings.mode}
     onChange={e=>updateNeighbourSettings({mode:e.target.value as typeof neighbourSettings.mode})}>
     <option value="off">Vypnuto, pouze ručně</option>
     <option value="important">Jen významné zastávky</option>
     <option value="all">Všechny ověřené sdílené nástupní hrany</option>
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
    <div className="settingsSectionHeading">Vyhodnocení pořadí dle aktuální odchylky</div>
    <label className="rememberOption"><input type="checkbox" checked={neighbourSettings.colourOrder}
     onChange={e=>updateNeighbourSettings({colourOrder:e.target.checked})}/>
     <span>Barevně hodnotit pravděpodobné pořadí</span></label>
    <label htmlFor="neighbourTolerance">Tolerance blízkých příjezdů (sekundy)</label>
    <input id="neighbourTolerance" type="number" min="0" max="120" step="5"
     value={neighbourSettings.orderToleranceSeconds}
     onChange={e=>updateNeighbourSettings({orderToleranceSeconds:
      Math.max(0,Math.min(120,Number(e.target.value)||0))})}/>
    <label htmlFor="neighbourHysteresis">Hysterze změny barvy (sekundy)</label>
    <input id="neighbourHysteresis" type="number" min="0" max="30" step="5"
     value={neighbourSettings.orderHysteresisSeconds}
     onChange={e=>updateNeighbourSettings({orderHysteresisSeconds:
      Math.max(0,Math.min(30,Number(e.target.value)||0))})}/>
    <label htmlFor="neighbourLookahead">Ruční zobrazení: kolik zastávek dopředu</label>
    <input id="neighbourLookahead" type="number" min="1" max="10" step="1"
     value={neighbourSettings.lookahead} onChange={e=>updateNeighbourSettings({
      lookahead:Math.max(1,Math.min(10,Number(e.target.value)||1))
     })}/>
    <p className="hint">Spoje se filtrují podle očekávaného příjezdu, ale řadí výhradně podle JŘ. Používá se přesné ID nástupní hrany. Aktualizace nevyžaduje restart sledování.</p>
    <div className="settingsSectionHeading">Audit API požadavků · Fáze 0</div>
    <p className="hint">Pouze lokální záznam skutečných HTTP požadavků, zásahů cache a sdílených požadavků. Bez API klíčů, GPS, konkrétních trip ID nebo úplných URL. Záznam je v paměti této relace prohlížeče (max. 1500 událostí).</p>
    <label htmlFor="networkAuditScenario">Testovací scénář</label>
    <select id="networkAuditScenario" defaultValue={getNetworkAuditScenario()}
     onChange={e=>setNetworkAuditScenario(e.target.value)}>
     <option value="default">Běžné použití</option>
     <option value="start">Spuštění sledování</option>
     <option value="tracking-15m">15 minut sledování</option>
     <option value="chain">Řetězená linka</option>
     <option value="chooser">Výběr spoje</option>
     <option value="stop-board">Okolní odjezdy</option>
     <option value="background">Pozadí / návrat</option>
     <option value="api-outage">Výpadek API</option>
     <option value="other-mode">Jiný druh dopravy</option>
    </select>
    <button className="quiet full" type="button" onClick={downloadNetworkAudit}>Export auditu API (JSON)</button>
    <button className="quiet full" type="button" onClick={clearNetworkAudit}>Vymazat zaznamenané požadavky</button>
    <button className="quiet full" disabled={!token} onClick={forget}>Zapomenout API klíč</button>
    <button className="primary full" onClick={()=>setSettings(false)}>Hotovo</button>
   </div>
  </div>}
 </main>;
}
