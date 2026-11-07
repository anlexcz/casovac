import {Fragment,useLayoutEffect,useRef,useState} from 'react';
import type {Stop} from './tripData';
import {formatStopTime} from './tripData';
import {chainBoard} from './chainStops';
import {formatNeighbourDelay} from './stopNeighbours';
import type {NeighbourResult,NeighbourSettings} from './stopNeighbours';

type Props={
 stops:Stop[];index:number|null;tripId:string;remaining:number|null;terminalWaiting:boolean;
 expanded:boolean;onExpand:()=>void;onChoose:(index:number)=>void;animate:boolean;
 continuation:{line:string;order:string;stops:Stop[]}|null;
 predecessor:{line:string;order:string;stops:Stop[]}|null;
 activeLine:string;visualBoundary:boolean;
 neighbours:NeighbourResult|null;neighbourLoading:boolean;neighbourError:string;
 neighbourSettings:NeighbourSettings;neighbourIndex:number|null;
 setNeighbourIndex:(value:number|null)=>void;
};
function signed(remaining:number|null){
 if(remaining===null)return '—';
 const elapsed=-remaining,abs=Math.abs(elapsed);
 return (elapsed<0?'−':'+')+String(Math.floor(abs/60)).padStart(2,'0')+':'+String(abs%60).padStart(2,'0');
}
type Snapshot={
 trip:string;index:number;rects:Map<number,DOMRect>;
 previousName:string;previousTime:string;previousOffset:string;
};
function NeighbourTable({data,loading,error}:{
 data:NeighbourResult|null;loading:boolean;error:string
}){
 return <div className="stopNeighbourTable" aria-label="Okolní spoje na stejné nástupní hraně">
  <p className="neighbourCaption">Stejná nástupní hrana · seřazeno dle JŘ</p>
  {loading&&<p className="hint">Načítám okolní spoje…</p>}
  {error&&<p className="hint" role="status">Nepodařilo se načíst okolní spoje: {error}</p>}
  {!loading&&!error&&!data?.rows.length&&<p className="hint">Žádné ověřené blízké spoje v nastaveném okně.</p>}
  {!!data?.rows.length&&!loading&&<div className="neighbourRows">
   {data.rows.map((row,i)=><div className={'neighbourRow neighbour-'+row.relative} key={row.tripId}>
    {(i===0||data.rows[i-1].relative!==row.relative)&&<div className="neighbourGroupLabel">
     {row.relative==='before'?'↑ Patří před tebe':row.relative==='same'?'= Stejný čas dle JŘ':'↓ Patří za tebe'}
    </div>}
    <span className="neighbourBadge">{row.line}/{row.order}</span>
    <span className="neighbourVehicle">{row.vehicle?'#'+row.vehicle:'—'}</span>
    <span className="neighbourDelay" title="Odchylka od vlastního jízdního řádu">{formatNeighbourDelay(row.delay)}</span>
    <time className="neighbourTime" title="Čas podle jízdního řádu">{row.scheduled.slice(0,5)}</time>
   </div>)}
  </div>}
  <small className="neighbourDisclaimer">Orientační informace, nikoliv pokyn k přednosti nebo vjezdu.</small>
 </div>;
}
export default function StopBoard({stops,index,tripId,remaining,terminalWaiting,expanded,onExpand,onChoose,animate,continuation,predecessor,activeLine,visualBoundary,neighbours,neighbourLoading,neighbourError,neighbourSettings,neighbourIndex,setNeighbourIndex}:Props){
 const [closedAuto,setClosedAuto]=useState('');
 const [forcedCurrent,setForcedCurrent]=useState('');
 const activeKey=tripId+'|'+index;
 const canAutoOpen=neighbourSettings.mode!=='off'&&
  (neighbourSettings.mode==='all'?!!neighbours?.rows.length:!!neighbours?.significant);
 const currentOpen=neighbourSettings.enabled&&neighbourIndex===null&&
  (forcedCurrent===activeKey||canAutoOpen)&&closedAuto!==activeKey;
 const selectedOpen=neighbourSettings.enabled&&neighbourIndex!==null;
 const toggleNeighbour=(i:number)=>{
  if(i===index){
   if(selectedOpen)setNeighbourIndex(null);
   else if(currentOpen){setClosedAuto(activeKey);setForcedCurrent('');}
   else {setClosedAuto('');setForcedCurrent(activeKey);setNeighbourIndex(null);}
  }else setNeighbourIndex(neighbourIndex===i?null:i);
 };
 const table=(i:number)=>neighbourSettings.enabled&&(i===index?currentOpen||selectedOpen&&neighbourIndex===index:neighbourIndex===i)&&
  <NeighbourTable data={neighbours} loading={neighbourLoading} error={neighbourError}/>;

 const stack=useRef<HTMLDivElement|null>(null);
 const activeCard=useRef<HTMLDivElement|null>(null);
 const previous=useRef<Snapshot|null>(null);
 const board=chainBoard(stops,predecessor,continuation,activeLine);
 const allStops=board.stops;
 const currentIndex=index===null?-1:board.offset+index;
 const valid=index!==null&&index>=0&&index<stops.length;
 const current=valid?allStops[currentIndex]?.stop:null;
 const end=expanded?allStops.length:Math.min(allStops.length,currentIndex+7);
 const shown=valid?allStops.slice(currentIndex+1,end):[];
 const clock=terminalWaiting?'clockTerminal':remaining===null?'clockUnknown':remaining>0?'clockEarly':'clockReady';

 useLayoutEffect(()=>{
  const root=stack.current,card=activeCard.current;
  if(!root||!card)return;
  // Only following stops have measured positions. The active coloured card is
  // a permanent layout anchor and must never participate in the FLIP movement.
  const nodes=Array.from(root.querySelectorAll<HTMLElement>('.upcomingStop[data-stop-index]'));
  const rects=new Map<number,DOMRect>();
  for(const node of nodes){
   const n=Number(node.dataset.stopIndex);
   if(Number.isInteger(n))rects.set(n,node.getBoundingClientRect());
  }
  const old=previous.current;
  const sequential=old!==null&&old.trip===tripId&&currentIndex===old.index+1;
  const reduced=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(sequential&&animate&&!reduced&&typeof Element.prototype.animate==='function'){
   // The lower rows slide into their new positions; never move the anchor card.
   for(const node of nodes){
    const n=Number(node.dataset.stopIndex),before=old.rects.get(n);
    if(!before)continue;
    const dy=before.top-node.getBoundingClientRect().top;
    if(Math.abs(dy)<1)continue;
    node.animate([{transform:'translateY('+dy+'px)'},{transform:'translateY(0)'}],
     {duration:610,easing:'cubic-bezier(.22,1,.36,1)'});
   }

   // Render a text-only snapshot of the departing stop OVER the fixed card.
   // The new stop's text fades in beneath it; neither card nor its background
   // moves or disappears, including during a colour/state change.
   card.querySelectorAll('.departingTextGhost').forEach(ghost=>ghost.remove());
   const ghost=document.createElement('div');
   ghost.className='departingTextGhost';
   ghost.setAttribute('aria-hidden','true');
   const name=document.createElement('span');
   name.className='activeStopName';name.textContent=old.previousName;
   const numbers=document.createElement('span');
   numbers.className='departureNumbers';
   const offset=document.createElement('span');
   offset.className='liveOffset';offset.textContent=old.previousOffset;
   const time=document.createElement('span');
   time.className='scheduledTime';time.textContent=old.previousTime;
   numbers.append(offset,time);
   ghost.append(name,numbers);
   card.appendChild(ghost);
   const departing=ghost.animate([
    {opacity:1,transform:'scale(1)'},
    {opacity:0,transform:'scale(.96)'}
   ],{duration:370,easing:'ease-out'});
   departing.onfinish=()=>ghost.remove();
   departing.oncancel=()=>ghost.remove();
   for(const element of Array.from(card.children)){
    if(element===ghost)continue;
    (element as HTMLElement).animate([
     {opacity:0,transform:'scale(.985)'},
     {opacity:0,transform:'scale(.985)',offset:.25},
     {opacity:1,transform:'scale(1)'}
    ],{duration:570,easing:'ease-out'});
   }
  }
  previous.current=!valid||!current?null:{
   trip:tripId,index:currentIndex,rects,previousName:current.name,
   previousTime:formatStopTime(current.departure||current.arrival),
   previousOffset:signed(remaining)
  };
 },[currentIndex,tripId,stops,expanded,animate,terminalWaiting]);
 if(!current)return null;
 return <div className="boardStack" ref={stack}>
  <div ref={activeCard} className={'activeDeparture '+clock}>
   <span className="activeStopName">{current.name}</span>
   <span className="departureNumbers">
    <span className="liveOffset" aria-label="Časový rozdíl vůči jízdnímu řádu">{signed(remaining)}</span>
    <time className="scheduledTime" aria-label="Čas podle jízdního řádu">{formatStopTime(current.departure||current.arrival)}</time>
   </span>
  </div>
  {neighbourSettings.enabled&&<button type="button" className="neighbourExpand neighbourExpandCurrent"
   aria-expanded={currentOpen||selectedOpen&&neighbourIndex===index}
   onClick={()=>toggleNeighbour(index!)}>Okolní spoje {currentOpen?'▴':'▾'}
  </button>}
  {table(index!)}
  {shown.map(entry=>{
   const {stop,index:n,continuation:isNext,changeTo,localIndex}=entry;
   return <Fragment key={(isNext?'next-':'current-')+n}>
    {changeTo&&!visualBoundary&&<div className="chainTransitionNote">↳ Dále jako linka {changeTo}</div>}
    <div data-stop-index={n} className="upcomingStop">
     {isNext?(
      <div className="upcomingButton chainUpcoming">
       <span className="upcomingName">{stop.name}</span>
       <time className="upcomingTime">{formatStopTime(stop.departure||stop.arrival)}</time>
      </div>
     ):(
      <button type="button" className="upcomingButton" onClick={()=>onChoose(localIndex)}
       title="Vybrat zastávku">
       <span className="upcomingName">{stop.name}</span>
       <time className="upcomingTime">{formatStopTime(stop.departure||stop.arrival)}</time>
      </button>
     )}
     {neighbourSettings.enabled&&!isNext&&localIndex>=0&&localIndex-(index??0)<=neighbourSettings.lookahead&&
      <button className="neighbourExpand neighbourExpandFuture" type="button"
       onClick={()=>toggleNeighbour(localIndex)}
       aria-label={'Okolní spoje: '+stop.name} aria-expanded={neighbourIndex===localIndex}>
       {neighbourIndex===localIndex?'▴':'▾'}
      </button>}
    </div>
    {neighbourIndex===localIndex&&!isNext&&table(localIndex)}
   </Fragment>;
  })}
  {allStops.length-currentIndex-1>6&&<button type="button" className="moreStops" onClick={onExpand}>
   {expanded?'Zobrazit méně':'Zobrazit dalších '+Math.max(0,allStops.length-currentIndex-7)+' zastávek'}
   <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d={expanded?'m6 15 6-6 6 6':'m6 9 6 6 6-6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  </button>}
 </div>;
}
