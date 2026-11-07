import {useEffect,useRef,useState} from 'react';
import StopNeighbours from './StopNeighbours';
import type {NeighbourResult,NeighbourSettings} from './stopNeighbours';
import './stopNeighbourSheet.css';

type Props={
 open:boolean;stopKey:string;name:string;platformCode:string;data:NeighbourResult|null;updatedAt:number;
 colourOrder:NeighbourSettings['colourOrder'];tolerance:number;hysteresis:number;
 loading:boolean;error:string;ownLine:string;ownOrder:string;ownVehicle:string;
 remainingSeconds:number|null;onInteraction:()=>void;onClose:()=>void;
};
export default function StopNeighbourSheet({
 open,stopKey,name,platformCode,data,updatedAt,loading,error,colourOrder,tolerance,hysteresis,ownLine,ownOrder,ownVehicle,remainingSeconds,onInteraction,onClose
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
    <span className="sn-sheet-grip" aria-hidden="true"/>
    <div className="sn-sheet-heading">
     <h2>{name||'Okolní spoje'}</h2>
     {platformCode&&<span className="sn-platform-badge">{platformCode}</span>}
    </div>
    <span className={'sn-sheet-refresh'+(error?' sn-refresh-error':'')}
     role="status" aria-label={error?'Aktualizace selhala':loading?'Probíhá aktualizace':'Stáří posledních živých dat'}
     title={error|| (age===null?'Čekám na první data':'Poslední dokončené či částečné načtení před '+age+' s')}>
     {loading?'↻':error?'!':age===null?'…':age+' s'}
    </span>
    {remainingSeconds!==null&&<span className="sn-sheet-countdown" aria-label={'Zavře se za '+Math.ceil(remainingSeconds)+' sekund'}>{Math.ceil(remainingSeconds)} s</span>}
    <button className="sn-sheet-close" type="button" onClick={onClose} aria-label="Zavřít okolní spoje">×</button>
   </header>
   <div className="sn-sheet-body">
    <StopNeighbours key={stopKey} data={data} updatedAt={updatedAt} loading={loading} error={error}
     colourOrder={colourOrder} tolerance={tolerance} hysteresis={hysteresis}
     ownLine={ownLine} ownOrder={ownOrder} ownVehicle={ownVehicle}/>
   </div>
  </section>
 </div>;
}
