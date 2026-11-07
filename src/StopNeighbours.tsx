import {useEffect,useRef,useState} from 'react';
import type {NeighbourResult} from './stopNeighbours.ts';
import {emptyStableNeighbours,reconcileNeighbours} from './stableNeighbours.ts';
import type {StableNeighbourState} from './stableNeighbours.ts';
import {formatNeighbourDelay} from './stopNeighbours.ts';
import './stopNeighbours.css';

type Props={data:NeighbourResult|null;loading:boolean;error:string;updatedAt:number;
 ownLine:string;ownOrder:string;ownVehicle:string};
export default function StopNeighbours({data,loading,error,updatedAt,ownLine,ownOrder,ownVehicle}:Props){
 const [stable,setStable]=useState<StableNeighbourState>(emptyStableNeighbours);
 const versionRef=useRef(0);
 const incoming=data?.rows??[];
 useEffect(()=>{
  // Stable trip identities keep each element mounted while fresh telemetry
  // updates only its delay and vehicle number.
  setStable(old=>reconcileNeighbours(old,incoming,updatedAt,!loading,Date.now()));
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[data,updatedAt,loading]);
 useEffect(()=>{
  if(!stable.entries.some(e=>e.exiting))return;
  const version=++versionRef.current;
  const timer=window.setTimeout(()=>{
   if(versionRef.current===version)
    setStable(old=>({...old,entries:old.entries.filter(e=>!e.exiting)}));
  },280);
  return()=>window.clearTimeout(timer);
 },[stable.entries.filter(e=>e.exiting).map(e=>e.row.tripId).join('|')]);
 const shown=stable.entries;
 const ownTime=data?.ownSchedule.slice(0,5)||'—';
 // A plain integrated timetable: no headers, no nested cards, no textual
 // group titles. Exact service order is always defined by scheduled time.
 const service=(entry:StableNeighbourState['entries'][number])=>{const row=entry.row;return <div className={'sn-row'+(entry.exiting?' sn-row-exit':'')} key={row.tripId}>
  <span className={"sn-arrow sn-arrow-"+row.relative} aria-label={row.relative==='before'?'Patří před tebe':row.relative==='after'?'Patří za tebe':'Shodný čas podle JŘ'}>
   {row.relative==='before'?'↑':row.relative==='after'?'↓':'→'}
  </span>
  <span className="sn-badge">{row.line}/{row.order}</span>
  <span className="sn-vehicle">{row.vehicle?'#'+row.vehicle:'—'}</span>
  <span className="sn-delay" title="Odchylka vůči jízdnímu řádu">{formatNeighbourDelay(row.delay)}</span>
  <time className="sn-time" title="Plánovaný čas">{row.scheduled.slice(0,5)}</time>
 </div>;};
 const own=<div className="sn-row sn-own" key="own" aria-label="Tvůj spoj">
  <span className="sn-arrow sn-arrow-same">→</span>
  <span className="sn-badge">{ownLine}/{ownOrder}</span>
  <span className="sn-vehicle">{ownVehicle?'#'+ownVehicle:'—'}</span>
  <span className="sn-delay">{data?.ownDelay===null||data?.ownDelay===undefined?'—':formatNeighbourDelay(data.ownDelay)}</span>
  <time className="sn-time">{ownTime}</time>
 </div>;
 const before=shown.filter(x=>x.row.relative==='before');
 const same=shown.filter(x=>x.row.relative==='same');
 const after=shown.filter(x=>x.row.relative==='after');
 return <div className="sn-panel" aria-label="Okolní spoje na stejné nástupní hraně">
  {shown.length>0?<div className="sn-rows">{before.map(service)}{own}{same.map(service)}{after.map(service)}</div>:
   <p className="sn-status">{error?'Online údaje nejsou dostupné':loading?'Načítám okolní spoje…':'Žádné blízké spoje'}</p>}
  {loading&&shown.length>0&&<span className="sn-updating" aria-label="Aktualizuji okolní spoje">↻</span>}
 </div>;
}
