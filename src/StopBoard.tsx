import {useLayoutEffect,useRef} from 'react';
import type {Stop} from './tripData';
import {formatStopTime} from './tripData';
import {continuousStops} from './chainStops';

type Props={
 stops:Stop[];index:number|null;tripId:string;remaining:number|null;terminalWaiting:boolean;
 expanded:boolean;onExpand:()=>void;onChoose:(index:number)=>void;animate:boolean;
 continuation:{line:string;order:string;stops:Stop[]}|null;
};
function signed(remaining:number|null){
 if(remaining===null)return '—';
 const elapsed=-remaining,abs=Math.abs(elapsed);
 return (elapsed<0?'−':'+')+String(Math.floor(abs/60)).padStart(2,'0')+':'+String(abs%60).padStart(2,'0');
}
type Snapshot={
 trip:string;index:number;rects:Map<number,DOMRect>;
 previousName:string;previousTime:string;previousOffset:string;previousClock:string;
};
export default function StopBoard({stops,index,tripId,remaining,terminalWaiting,expanded,onExpand,onChoose,animate,continuation}:Props){
 const stack=useRef<HTMLDivElement|null>(null);
 const previous=useRef<Snapshot|null>(null);
 const currentIndex=index??-1;
 const valid=currentIndex>=0&&currentIndex<stops.length;
 const current=valid?stops[currentIndex]:null;
 const allStops=continuousStops(stops,continuation?.stops??null,!!continuation);
 const end=expanded?allStops.length:Math.min(allStops.length,currentIndex+7);
 const shown=valid?allStops.slice(currentIndex,end):[];
 const clock=terminalWaiting?'clockTerminal':remaining===null?'clockUnknown':remaining>0?'clockEarly':'clockReady';
 useLayoutEffect(()=>{
  const root=stack.current;
  if(!root)return;
  const nodes=Array.from(root.querySelectorAll<HTMLElement>('[data-stop-index]'));
  const rects=new Map<number,DOMRect>();
  for(const node of nodes){
   const n=Number(node.dataset.stopIndex);
   if(Number.isInteger(n))rects.set(n,node.getBoundingClientRect());
  }
  const old=previous.current;
  const sequential=old!==null&&old.trip===tripId&&index!==null&&index===old.index+1;
  const reduced=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(sequential&&animate&&!reduced&&typeof Element.prototype.animate==='function'){
   const duration=720;
   for(const node of nodes){
    const n=Number(node.dataset.stopIndex),before=old.rects.get(n);
    if(before===undefined)continue;
    const after=node.getBoundingClientRect(),dy=before.top-after.top;
    const promoted=n===index;
    if(Math.abs(dy)<1&&!promoted)continue;
    node.animate([
     {transform:'translateY('+dy+'px)',opacity:1,
      ...(promoted?{backgroundColor:'rgba(255,255,255,0)'}:{})},
     {transform:'translateY(0)',opacity:1,
      ...(promoted?{backgroundColor:getComputedStyle(node).backgroundColor}:{})}
    ],{duration,easing:'cubic-bezier(.22,1,.36,1)'});
   }
   // The real old row has left the React list. Its ghost moves out *once*
   // and never participates in layout or the list's FLIP calculations.
   const oldRect=old.rects.get(old.index);
   if(oldRect){
    const ghost=document.createElement('div');
    ghost.className='departingStop '+old.previousClock;
    ghost.setAttribute('aria-hidden','true');
    ghost.style.top=(oldRect.top-root.getBoundingClientRect().top)+'px';
    ghost.style.height=oldRect.height+'px';
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
    root.appendChild(ghost);
    const movement=ghost.animate([
     {transform:'translateY(0)',opacity:1},
     {transform:'translateY(-'+Math.min(85,Math.round(oldRect.height))+'px)',opacity:0}
    ],{duration:520,easing:'cubic-bezier(.22,1,.36,1)'});
    movement.onfinish=()=>ghost.remove();
    movement.oncancel=()=>ghost.remove();
   }
  }
  previous.current=index===null||!current?null:{
   trip:tripId,index,rects,previousName:current.name,
   previousTime:formatStopTime(current.departure||current.arrival),
   previousOffset:signed(remaining),
   previousClock:clock
  };
 },[index,tripId,stops,expanded,animate,clock==='clockTerminal']);
 if(!current)return null;
 return <div className="boardStack" ref={stack}>
  {shown.map((entry,i)=>{
   const {stop,n,continuation:isNext}=entry,primary=i===0;
   return <div key={(isNext?'next-':'current-')+n}
    data-stop-index={n} className={primary?'activeDeparture '+clock:'upcomingStop'}>
    {primary?<>
     <span className="activeStopName">{stop.name}</span>
     <span className="departureNumbers">
      <span className="liveOffset" aria-label="Časový rozdíl vůči jízdnímu řádu">{signed(remaining)}</span>
      <time className="scheduledTime" aria-label="Čas podle jízdního řádu">{formatStopTime(stop.departure||stop.arrival)}</time>
     </span>
    </>:isNext?<>
     {n===stops.length&&<div className="chainLabel" aria-label={'Pokračování linkou '+continuation?.line}>
      <span className="chainLine">{continuation?.line}</span>
      Pokračování jako {continuation?.line}/{continuation?.order}
     </div>}
     <div className="upcomingButton chainUpcoming">
      <span className="upcomingName">{stop.name}</span>
      <time className="upcomingTime">{formatStopTime(stop.departure||stop.arrival)}</time>
     </div>
    </>:<button type="button" className="upcomingButton" onClick={()=>onChoose(n)}
       title="Vybrat zastávku">
     <span className="upcomingName">{stop.name}</span>
     <time className="upcomingTime">{formatStopTime(stop.departure||stop.arrival)}</time>
    </button>}
   </div>;
  })}
  {allStops.length-currentIndex-1>6&&<button type="button" className="moreStops" onClick={onExpand}>
   {expanded?'Zobrazit méně':'Zobrazit dalších '+(allStops.length-currentIndex-7)+' zastávek'}
   <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d={expanded?'m6 15 6-6 6 6':'m6 9 6 6 6-6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  </button>}
 </div>;
}
