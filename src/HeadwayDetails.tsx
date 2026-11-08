import {useEffect,useRef,useState} from 'react';
import {pidStatic} from './pidStatic.ts';
import type {PidTripStop} from './pidStatic.ts';
import type {PlannedHeadways,PlannedPeer} from './plannedHeadways.ts';
import type {PlannedLiveHeadways} from './plannedLiveHeadways.ts';
import {estimatedPeerGap} from './plannedLiveHeadways.ts';
import {formatHeadway} from './lineHeadways.ts';
import {plannedPeerStopName,livePeerStopName} from './headwayPeerLocation.ts';
import {routeOf,selectedTripId,vehicleId} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import {freshTripPosition} from './plannedPeerPosition.ts';
import {observationTimestamp} from './remoteTracking.ts';
import {displayDutyPhase} from './trackedDuty.ts';
import type {DutyPhase} from './trackedDuty.ts';
import {stableHeadway} from './stableHeadway.ts';
import type {HeadwaySnapshot} from './stableHeadway.ts';
import {headwaySnapshotKey,mayPromoteHeadwaySnapshot} from './headwaySnapshotIdentity.ts';

type Side='ahead'|'behind';
type Props={
 planned:PlannedHeadways;loading:boolean;live:PlannedLiveHeadways;
 features:Feature[];selected:Feature|null;date:string;now:number;
 tripId:string;peerTripIds:{ahead:string;behind:string};
 ownDutyId:string;peerDutyIds:Record<Side,string>;
 phases?:Record<Side,DutyPhase>;peerStatus?:Record<Side,string>;
};
function StateIcon({verified}:{verified:boolean}){
 return verified?
  <svg className="headwayStatusIcon headwayStatusLive" viewBox="0 0 24 24" aria-label="Živě ověřeno" role="img">
   <path d="M12 19v-3m-3.5 3.2a5 5 0 0 1 7 0M5.7 16a9 9 0 0 1 12.6 0M3 12.8a13 13 0 0 1 18 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
   <circle cx="12" cy="21" r="1.1" fill="currentColor"/>
  </svg>:
  <svg className="headwayStatusIcon headwayStatusPlan" viewBox="0 0 24 24" aria-label="Bez živého ověření" role="img">
   <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/>
   <path d="M5.7 18.3 18.3 5.7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>;
}
function usePeerStops(peer:PlannedPeer|null,date:string){
 const key=peer&&date?date+'|'+peer.tripId:'';
 const [state,setState]=useState<{key:string;stops:PidTripStop[]|null;loading:boolean}>({
  key:'',stops:null,loading:false
 });
 useEffect(()=>{
  if(!peer||!date){setState({key:'',stops:null,loading:false});return;}
  let alive=true;
  setState({key,stops:null,loading:true});
  void (async()=>{
   try{
    const trip=await pidStatic.getTripResolved(peer.tripId,date);
    if(!trip||trip.id!==peer.tripId||trip.date!==date)return null;
    return await pidStatic.getTripStops(peer.tripId,date,trip.routeId);
   }catch{return null;}
  })().then(stops=>{if(alive)setState({key,stops,loading:false});});
  return()=>{alive=false;};
 },[key]);
 return state.key===key?state:{key,stops:null,loading:!!key};
}
const matchLive=(peer:PlannedPeer,observedId:string,features:Feature[],now:number):Feature|null=>{
 const matching=features.filter(f=>selectedTripId(f)===observedId&&
  (observedId!==peer.tripId||routeOf(f)===peer.line)&&freshTripPosition(f,now));
 return matching.length===1?matching[0]:null;
};
export default function HeadwayDetails({planned,loading,live,features,selected,date,now,tripId,peerTripIds,
 ownDutyId,peerDutyIds,
 phases={ahead:'unknown',behind:'unknown'},peerStatus={ahead:'none',behind:'none'}}:Props){
 // Cache by the *pair*, not by side alone: moving between timetable stops
 // may briefly select a different peer, then return to the same actual duty.
 const snapshots=useRef<Map<string,HeadwaySnapshot>>(new Map());
 const remembered=useRef<Record<Side,{
  snapshot:HeadwaySnapshot|null;peerTripId:string;ownDutyId:string;
 }>>({
  ahead:{snapshot:null,peerTripId:'',ownDutyId:''},
  behind:{snapshot:null,peerTripId:'',ownDutyId:''}
 });
 const [side,setSide]=useState<Side|null>(null);
 const root=useRef<HTMLDivElement>(null);
 const buttons=useRef<Record<Side,HTMLButtonElement|null>>({ahead:null,behind:null});
 const [placement,setPlacement]=useState<{left:number;top:number}|null>(null);
 const place=(rect:DOMRect)=>{
  const width=Math.min(280,window.innerWidth-24);
  const left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12));
  // One-line popup; reserve enough room for wrapped long stop names.
  const above=rect.bottom+80>window.innerHeight&&rect.top>88;
  const top=above?Math.max(12,rect.top-75):rect.bottom+6;
  setPlacement({left,top});
 };
 const front=planned.status==='ready'?planned.ahead:null;
 const rear=planned.status==='ready'?planned.behind:null;
 const current=side==='ahead'?front:side==='behind'?rear:null;
 const currentLive=side==='ahead'?live.ahead:side==='behind'?live.behind:null;
 const observedTripId=side?peerTripIds[side]:'';
 const isLive=!!current&&currentLive!==null;
 const feature=current&&isLive?matchLive(current,observedTripId||current.tripId,features,now):null;
 const positionedPeer=current&&feature&&observedTripId&&observedTripId!==current.tripId?
  {...current,tripId:observedTripId}:current;
 const stops=usePeerStops(positionedPeer,date);
 const liveStop=isLive&&feature?livePeerStopName(feature,stops.stops):null;
 const plannedStop=current&&!isLive?plannedPeerStopName(stops.stops,date,now):null;
 const stopName=isLive?(liveStop??(plannedStop?'JŘ: '+plannedStop:null)):plannedStop;
 useEffect(()=>{setSide(null);},[tripId]);
 useEffect(()=>{
  if(!side)return;
  const reposition=()=>{const button=buttons.current[side];if(button)place(button.getBoundingClientRect());};
  window.addEventListener('resize',reposition);
  window.addEventListener('scroll',reposition,true);
  const handlePointer=(event:PointerEvent)=>{
   if(root.current&&!root.current.contains(event.target as Node))setSide(null);
  };
  const handleKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setSide(null);};
  document.addEventListener('pointerdown',handlePointer);
  document.addEventListener('keydown',handleKey);
  return()=>{document.removeEventListener('pointerdown',handlePointer);
   document.removeEventListener('keydown',handleKey);
   window.removeEventListener('resize',reposition);
   window.removeEventListener('scroll',reposition,true);};
 },[side]);
 const renderButton=(which:Side,peer:PlannedPeer|null)=>{
  if(!peer||!displayDutyPhase(phases[which]))return null;
  const measured=which==='ahead'?live.ahead:live.behind;
  const observed=features.find(f=>selectedTripId(f)===(peerTripIds[which]||peer.tripId));
  const timeA=selected?observationTimestamp(selected):null;
  const timeB=observed?observationTimestamp(observed):null;
  const observationTime=timeA!==null&&timeB!==null?Math.min(timeA,timeB):null;
  // A change of displayed stop or route trip never invalidates an already
  // measured gap between the same scheduled duties. A different neighbour
  // (including a different block) gets a separate cache identity.
  const stableKey=headwaySnapshotKey({
   date,ownDutyId:ownDutyId||'trip:'+tripId,
   peerDutyId:peerDutyIds[which]||'trip:'+peer.tripId,side:which
  });
  const prior=remembered.current[which];
  const canPromote=!!prior.snapshot&&
   (peerDutyIds[which]??'').startsWith('block:')&&
   mayPromoteHeadwaySnapshot({
    previousPeerTrip:prior.peerTripId,nextPeerTrip:peer.tripId,
    previousOwnDuty:prior.ownDutyId,nextOwnDuty:ownDutyId||'trip:'+tripId,
    previousKey:prior.snapshot.key,nextKey:stableKey
   });
  const previous=snapshots.current.get(stableKey)??(
   canPromote&&prior.snapshot?{...prior.snapshot,key:stableKey}:null);
  const stable=stableHeadway(previous,stableKey,measured,observationTime,now);
  if(stable.snapshot)snapshots.current.set(stableKey,stable.snapshot);
  else snapshots.current.delete(stableKey);
  // Bound the small historical map; expiry uses the actual source time, not
  // the time the user visited the reference stop.
  if(snapshots.current.size>20){
   for(const [id,item] of snapshots.current){
    if(now-item.observedAt>180000)snapshots.current.delete(id);
   }
   while(snapshots.current.size>20)
    snapshots.current.delete(snapshots.current.keys().next().value!);
  }
  remembered.current[which]={
   snapshot:stable.snapshot,peerTripId:peer.tripId,
   ownDutyId:ownDutyId||'trip:'+tripId
  };
  const verified=stable.quality==='live';
  const seconds=stable.seconds??estimatedPeerGap({
   planned:peer,side:which,selected,now
  });
  const label=which==='ahead'?'Spoj přede mnou':'Spoj za mnou';
  return <button key={which} ref={node=>{buttons.current[which]=node;}} type="button" className={'headwayToggle'+
   (side===which?' headwayToggleSelected':'')} aria-expanded={side===which}
   aria-label={label+': '+formatHeadway(seconds)+
    (verified?', živě ověřeno':stable.quality==='last-known'?', poslední známá hodnota':', pouze podle JŘ')+
    '. Otevřít podrobnosti.'}
   title={label+(verified?' · LIVE':stable.quality==='last-known'?
    ' · poslední měření, bez aktuální LIVE polohy':' · PID GTFS / odhad')+
    (peerStatus[which]==='provisional'?' · návaznost bloku bez ověření téhož vozu':'')}
   onClick={event=>{place(event.currentTarget.getBoundingClientRect());
    setSide(previous=>previous===which?null:which);}}
   disabled={!peer}>
   <span className="headwayArrow" aria-hidden="true">{which==='ahead'?'↑':'↓'}</span>
   <span className="headwayTime">{stable.quality==='last-known'?'≈':''}{formatHeadway(seconds)}</span>
   <StateIcon verified={verified}/>
  </button>;
 };
 return <div className="headwayDetailsRoot" ref={root}>
  <div className="compactHeadways" aria-label="Rozestupy předchozí a následující tramvaje">
   {renderButton('ahead',front)}
   {renderButton('behind',rear)}
  </div>
  {side&&current&&displayDutyPhase(phases[side])&&<div className="headwayPopover headwayPopoverInline" role="dialog"
   style={placement?{left:placement.left,top:placement.top}:undefined}
   aria-label={'Podrobnosti: spoj '+(side==='ahead'?'přede mnou':'za mnou')}>
   <span className="headwayInlineIdentity">
    {current.line}{isLive&&currentLive?.order?'/'+currentLive.order:''}
   </span>
   {isLive&&feature&&vehicleId(feature)!=='—'&&
    <span className="headwayInlineVehicle">#{vehicleId(feature)}</span>}
   <span className="headwayInlineStop" title={stopName??undefined}>
    {stopName??(stops.loading?'Načítám zastávku…':'Zastávka nedostupná')}
   </span>
  </div>}
  {loading&&<span className="srOnly" role="status">Načítám plánované sousední spoje.</span>}
 </div>;
}
