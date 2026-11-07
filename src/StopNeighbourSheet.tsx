import {useEffect,useRef} from 'react';
import StopNeighbours from './StopNeighbours';
import type {NeighbourResult} from './stopNeighbours';
import './stopNeighbourSheet.css';

type Props={
 open:boolean;name:string;platformCode:string;data:NeighbourResult|null;
 loading:boolean;error:string;ownLine:string;ownOrder:string;ownVehicle:string;
 onClose:()=>void;
};
export default function StopNeighbourSheet({
 open,name,platformCode,data,loading,error,ownLine,ownOrder,ownVehicle,onClose
}:Props){
 const touchStart=useRef<number|null>(null);
 useEffect(()=>{
  if(!open)return;
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
  window.addEventListener('keydown',key);
  return()=>window.removeEventListener('keydown',key);
 },[open,onClose]);
 return <div className={'sn-sheet-layer'+(open?' sn-sheet-open':'')}
  aria-hidden={!open}>
  <div className="sn-sheet-backdrop" onClick={onClose}/>
  <section className="sn-sheet" role="dialog" aria-modal="true"
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
    <button className="sn-sheet-close" type="button" onClick={onClose} aria-label="Zavřít okolní spoje">×</button>
   </header>
   <div className="sn-sheet-body">
    <StopNeighbours data={data} loading={loading} error={error}
     ownLine={ownLine} ownOrder={ownOrder} ownVehicle={ownVehicle}/>
   </div>
  </section>
 </div>;
}
