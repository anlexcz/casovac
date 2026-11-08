import {useEffect,useRef,useState} from 'react';
import StopNeighbours from './StopNeighbours';
import type {NeighbourResult,NeighbourSettings} from './stopNeighbours';
import './stopNeighbourSheet.css';

type Props={
 open:boolean;stopKey:string;name:string;platformCode:string;data:NeighbourResult|null;updatedAt:number;
 colourOrder:NeighbourSettings['colourOrder'];tolerance:number;hysteresis:number;
 loading:boolean;error:string;liveIncomplete?:boolean;ownLine:string;ownOrder:string;ownVehicle:string;
 remainingSeconds:number|null;countdownTotalSeconds:number;onInteraction:()=>void;onClose:()=>void;
};
export default function StopNeighbourSheet({
 open,stopKey,name,platformCode,data,updatedAt,loading,error,liveIncomplete,colourOrder,tolerance,hysteresis,ownLine,ownOrder,ownVehicle,remainingSeconds,countdownTotalSeconds,onInteraction,onClose
}:Props){
 const touchStart=useRef<number|null>(null);
 const [ageNow,setAgeNow]=useState(Date.now());
 useEffect(()=>{
  if(!open)return;
  setAgeNow(Date.now());
  const id=window.setInterval(()=>setAgeNow(Date.now()),5000);
  return()=>window.clearInterval(id);
 },[open]);
 const age=updatedAt>0?Math.max(0,Math.floor((ageNow-updatedAt)/1000)):null;
 const countdownRatio=remainingSeconds!==null&&countdownTotalSeconds>0?
  Math.max(0,Math.min(1,remainingSeconds/countdownTotalSeconds)):null;
 useEffect(()=>{
  if(!open)return;
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
  window.addEventListener('keydown',key);
  return()=>window.removeEventListener('keydown',key);
 },[open,onClose]);
 return <div className={'sn-sheet-layer'+(open?' sn-sheet-open':'')}
  aria-hidden={!open}>

  <section className="sn-sheet" role="dialog" aria-modal="false"
   onPointerDown={onInteraction} onWheel={onInteraction} onTouchMove={onInteraction}
   aria-label={'Okolní spoje: '+name}>
   <header className="sn-sheet-header"
    onTouchStart={e=>{touchStart.current=e.touches[0]?.clientY??null;}}
    onTouchEnd={e=>{
     if(touchStart.current!==null&&(e.changedTouches[0]?.clientY??0)-touchStart.current>70)onClose();
     touchStart.current=null;
    }}>
    {countdownRatio!==null&&<div className="sn-sheet-timer"
     role="progressbar" aria-label="Čas zbývající do automatického zavření"
     aria-valuemin={0} aria-valuemax={countdownTotalSeconds}
     aria-valuenow={Math.max(0,Math.ceil(remainingSeconds!))}
     title={'Automatické zavření za '+Math.ceil(remainingSeconds!)+' s'}>
     <div className="sn-sheet-timer-fill" style={{transform:'scaleX('+countdownRatio+')'}}/>
    </div>}
    <span className="sn-sheet-grip" aria-hidden="true"/>
    <div className="sn-sheet-heading">
     <h2>{name||'Okolní spoje'}</h2>
     {platformCode&&<span className="sn-platform-badge">{platformCode}</span>}
    </div>
    <span className={'sn-sheet-refresh'+(error?' sn-refresh-error':'')}
     role="status" aria-label={error?'Aktualizace selhala':loading?'Probíhá aktualizace':'Stáří posledních živých dat'}
     title={error|| (age===null?'Čekám na první data':'Poslední dokončené či částečné načtení před '+age+' s')}>
     <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M20 7v5h-5M4 17v-5h5M5.8 9A7 7 0 0 1 18 6.7L20 12M4 12l2 5.3A7 7 0 0 0 18.2 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
     </svg>
     <span>{loading?'…':error?'!':age===null?'—':age+' s'}</span>
    </span>
    <button className="sn-sheet-close" type="button" onPointerDown={e=>e.stopPropagation()}
     onClick={e=>{e.stopPropagation();onClose();}} aria-label="Zavřít okolní spoje">×</button>
   </header>
   <div className="sn-sheet-body">
    <StopNeighbours key={stopKey} data={data} updatedAt={updatedAt} loading={loading} error={error} liveIncomplete={liveIncomplete}
     colourOrder={colourOrder} tolerance={tolerance} hysteresis={hysteresis}
     ownLine={ownLine} ownOrder={ownOrder} ownVehicle={ownVehicle}/>
   </div>
  </section>
 </div>;
}
