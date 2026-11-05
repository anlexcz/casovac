import {useLayoutEffect,useRef} from 'react';
import type {Stop} from './tripData';
import {formatStopTime} from './tripData';

type Props={
 stops:Stop[];index:number|null;tripId:string;remaining:number|null;terminalWaiting:boolean;
 expanded:boolean;onExpand:()=>void;onChoose:(index:number)=>void;
 animate:boolean;
};
function signed(remaining:number|null){
 if(remaining===null)return '—';
 const elapsed=-remaining,abs=Math.abs(elapsed);
 return (elapsed<0?'−':'+')+String(Math.floor(abs/60)).padStart(2,'0')+':'+String(abs%60).padStart(2,'0');
}
type Snapshot={trip:string;index:number;rects:Map<string,DOMRect>};
export default function StopBoard({stops,index,tripId,remaining,terminalWaiting,expanded,onExpand,onChoose,animate}:Props){
 const stack=useRef<HTMLDivElement|null>(null);
 const previous=useRef<Snapshot|null>(null);
 const currentIndex=index??-1;
 const valid=currentIndex>=0&&currentIndex<stops.length;
 const current=valid?stops[currentIndex]:null;
 const future=valid?stops.slice(currentIndex+1):[];
 const list=expanded?future:future.slice(0,6);
 const clock=terminalWaiting?'clockTerminal':remaining===null?'clockUnknown':remaining>0?'clockEarly':'clockReady';
 useLayoutEffect(()=>{
  const root=stack.current;
  if(!root)return;
  const elements=Array.from(root.querySelectorAll<HTMLElement>('[data-stop-key]'));
  const next=new Map<string,DOMRect>();
  for(const element of elements){
   const key=element.dataset.stopKey;
   if(key)next.set(key,element.getBoundingClientRect());
  }
  const old=previous.current;
  const sequential=!!old&&old.trip===tripId&&index!==null&&index===old.index+1;
  const reduced=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(sequential&&animate&&!reduced&&typeof Element.prototype.animate==='function'){
   for(const element of elements){
    const key=element.dataset.stopKey;
    const before=key?old.rects.get(key):null;
    if(!before)continue;
    const after=element.getBoundingClientRect();
    const dy=before.top-after.top;
    if(Math.abs(dy)<1)continue;
    element.animate([
     {transform:'translateY('+dy+'px)',opacity:.96},
     {transform:'translateY(0)',opacity:1}
    ],{duration:800,easing:'cubic-bezier(.22,1,.36,1)'});
   }
   // The former active row leaves upward while the next stop takes its place.
   const previousKey='stop-'+old.index;
   const before=old.rects.get(previousKey);
   if(before){
    const ghost=document.createElement('div');
    ghost.className='departureGhost';
    ghost.setAttribute('aria-hidden','true');
    ghost.style.cssText='top:'+(before.top-root.getBoundingClientRect().top)+'px;height:'+before.height+'px;';
    const former=stops[old.index];
    ghost.textContent=former?.name??'';
    root.appendChild(ghost);
    const motion=ghost.animate([
     {transform:'translateY(0)',opacity:.58},
     {transform:'translateY(-54px)',opacity:0}
    ],{duration:660,easing:'ease-out'});
    motion.onfinish=()=>ghost.remove();
    motion.oncancel=()=>ghost.remove();
   }
  }
  previous.current=index===null?null:{trip:tripId,index,rects:next};
 },[index,tripId,stops,expanded,animate]);
 if(!current)return null;
 return <div className="boardStack" ref={stack}>
  <div className={'activeDeparture '+clock} data-stop-key={'stop-'+currentIndex}>
   <span className="activeStopName">{current.name}</span>
   <span className="departureNumbers">
    <span className="liveOffset" aria-label="Časový rozdíl vůči jízdnímu řádu">{signed(remaining)}</span>
    <time className="scheduledTime" aria-label="Čas podle jízdního řádu">{formatStopTime(current.departure||current.arrival)}</time>
   </span>
  </div>
  {future.length>0&&<div className="upcomingStops">
   {list.map((stop,i)=><button
    type="button" className="upcomingStop" key={stop.sequence+'-'+i}
    data-stop-key={'stop-'+(currentIndex+i+1)}
    onClick={()=>onChoose(currentIndex+i+1)} title="Vybrat zastávku">
     <span className="upcomingName">{stop.name}</span>
     <time className="upcomingTime">{formatStopTime(stop.departure||stop.arrival)}</time>
    </button>)}
   {future.length>6&&<button type="button" className="moreStops" onClick={onExpand}>
    {expanded?'Zobrazit méně':'Zobrazit dalších '+(future.length-6)+' zastávek'}
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d={expanded?'m6 15 6-6 6 6':'m6 9 6 6 6-6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
   </button>}
  </div>}
 </div>;
}
