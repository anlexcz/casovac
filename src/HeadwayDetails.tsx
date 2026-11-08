import {useEffect,useRef,useState} from 'react';
import {pidStatic} from './pidStatic.ts';
import type {PidTripStop} from './pidStatic.ts';
import type {PlannedHeadways,PlannedPeer} from './plannedHeadways.ts';
import type {PlannedLiveHeadways} from './plannedLiveHeadways.ts';
import {estimatedPeerGap,verifiedPeerDelay} from './plannedLiveHeadways.ts';
import {formatHeadway} from './lineHeadways.ts';
import {plannedPeerLocation,livePeerLocation} from './headwayPeerLocation.ts';
import {routeOf,selectedTripId,vehicleId} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import {freshTripPosition} from './plannedPeerPosition.ts';

type Side='ahead'|'behind';
type Props={
 planned:PlannedHeadways;loading:boolean;live:PlannedLiveHeadways;
 features:Feature[];selected:Feature|null;date:string;now:number;
 tripId:string;
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
const matchLive=(peer:PlannedPeer,features:Feature[],now:number):Feature|null=>{
 const matching=features.filter(f=>selectedTripId(f)===peer.tripId&&
  routeOf(f)===peer.line&&freshTripPosition(f,now));
 return matching.length===1?matching[0]:null;
};
export default function HeadwayDetails({planned,loading,live,features,selected,date,now,tripId}:Props){
 const [side,setSide]=useState<Side|null>(null);
 const root=useRef<HTMLDivElement>(null);
 const buttons=useRef<Record<Side,HTMLButtonElement|null>>({ahead:null,behind:null});
 const [placement,setPlacement]=useState<{left:number;top:number}|null>(null);
 const place=(rect:DOMRect)=>{
  const width=Math.min(270,window.innerWidth-24);
  const left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12));
  const above=rect.bottom+190>window.innerHeight&&rect.top>192;
  const top=above?Math.max(12,rect.top-184):Math.min(rect.bottom+7,Math.max(12,window.innerHeight-60));
  setPlacement({left,top});
 };
 const front=planned.status==='ready'?planned.ahead:null;
 const rear=planned.status==='ready'?planned.behind:null;
 const current=side==='ahead'?front:side==='behind'?rear:null;
 const stops=usePeerStops(current,date);
 const currentLive=side==='ahead'?live.ahead:side==='behind'?live.behind:null;
 const isLive=!!current&&currentLive!==null;
 const feature=current&&isLive?matchLive(current,features,now):null;
 const location=isLive&&feature?livePeerLocation(feature,stops.stops):null;
 const liveLocationMissing=isLive&&location===null;
 const estimated=current?plannedPeerLocation(stops.stops,date,now):null;
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
  const measured=which==='ahead'?live.ahead:live.behind;
  const verified=!!peer&&measured!==null;
  const seconds=verified?measured!.seconds:estimatedPeerGap({
   planned:peer,side:which,selected,now
  });
  const label=which==='ahead'?'Spoj přede mnou':'Spoj za mnou';
  return <button key={which} ref={node=>{buttons.current[which]=node;}} type="button" className={'headwayToggle'+
   (side===which?' headwayToggleSelected':'')} aria-expanded={side===which}
   aria-label={label+': '+formatHeadway(seconds)+
    (verified?', živě ověřeno':', bez živého ověření')+
    '. Otevřít podrobnosti.'}
   title={label+(verified?' · LIVE':' · PID GTFS / odhad')}
   onClick={event=>{place(event.currentTarget.getBoundingClientRect());
    setSide(previous=>previous===which?null:which);}}
   disabled={!peer}>
   <span className="headwayArrow" aria-hidden="true">{which==='ahead'?'↑':'↓'}</span>
   <span className="headwayTime">{formatHeadway(seconds)}</span>
   {peer&&<StateIcon verified={verified}/>}
  </button>;
 };
 const currentGap=side==='ahead'?live.ahead?.seconds:side==='behind'?live.behind?.seconds:null;
 const displayGap=current?(currentGap??estimatedPeerGap({
  planned:current,side:side!,selected,now
 })):null;
 const deviation=feature&&isLive?verifiedPeerDelay(feature,now):null;
 return <div className="headwayDetailsRoot" ref={root}>
  <div className="compactHeadways" aria-label="Rozestupy předchozí a následující tramvaje">
   {renderButton('ahead',front)}
   {renderButton('behind',rear)}
  </div>
  {side&&current&&<div className="headwayPopover" role="dialog"
   style={placement?{left:placement.left,top:placement.top}:undefined}
   aria-label={'Podrobnosti: spoj '+(side==='ahead'?'přede mnou':'za mnou')}>
   <div className="headwayPopoverTop">
    <span className="headwayPopoverTime"><span className="headwayArrow" aria-hidden="true">
     {side==='ahead'?'↑':'↓'}</span><strong>{formatHeadway(displayGap)}</strong></span>
    <span className="headwayPopoverActions"><StateIcon verified={isLive}/>
     <button type="button" className="headwayClose" onClick={()=>setSide(null)}
      aria-label="Zavřít podrobnosti">×</button>
    </span>
   </div>
   <div className="headwayPopoverIdentity">
    <strong>{current.line}{isLive&&currentLive?.order?'/'+currentLive.order:''}</strong>
    {isLive&&feature&&vehicleId(feature)!=='—'&&<span>#{vehicleId(feature)}</span>}
    {isLive&&deviation!==null&&<span>{deviation>0?'+':''}{Math.round(deviation)} s</span>}
   </div>
   <div className="headwayPopoverLocation">
    <svg viewBox="0 0 24 24" aria-hidden="true" className="headwayPin">
     <path d="M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12Z" fill="none"
      stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="9" r="2.5"
      fill="none" stroke="currentColor" strokeWidth="1.8"/>
    </svg>
    <div className="headwayPopoverLocationText">
     <strong>{location?.title??(liveLocationMissing&&estimated?'Živá poloha neznámá':null)??
      estimated?.title??(stops.loading?'Načítám polohu…':'Poloha nedostupná')}</strong>
     <small>{location?.detail??(liveLocationMissing&&estimated?
      'JŘ: '+estimated.title+' · '+estimated.detail:null)??
      (estimated?.detail??(stops.loading?'Podle PID GTFS':'Bez potvrzených zastávek'))}
      {!isLive&&estimated&&<span className="headwayLocationHint"> · JŘ</span>}</small>
    </div>
   </div>
  </div>}
  {loading&&<span className="srOnly" role="status">Načítám plánované sousední spoje.</span>}
 </div>;
}
