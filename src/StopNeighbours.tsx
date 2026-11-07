import {useEffect,useRef,useState} from 'react';
import type {NeighbourResult,NeighbourSettings} from './stopNeighbours.ts';
import {formatNeighbourDelay} from './stopNeighbours.ts';
import {emptyStableNeighbours,reconcileNeighbours} from './stableNeighbours.ts';
import {orderColour,scheduledSeconds} from './neighbourOrderColour.ts';
import type {OrderColour} from './neighbourOrderColour.ts';
import './stopNeighbours.css';

type Props={
 data:NeighbourResult|null;loading:boolean;error:string;updatedAt:number;
 ownLine:string;ownOrder:string;ownVehicle:string;
 colourOrder:NeighbourSettings['colourOrder'];
 tolerance:number;hysteresis:number;
};
export default function StopNeighbours({
 data,loading,error,updatedAt,ownLine,ownOrder,ownVehicle,
 colourOrder,tolerance,hysteresis
}:Props){
 const [stable,setStable]=useState(emptyStableNeighbours);
 const lastOwn=useRef<NeighbourResult|null>(null);
 const colours=useRef(new Map<string,OrderColour>());
 const incoming=data?.rows??[];
 useEffect(()=>{
  // New API batches update existing rows by tripId. Already verified trips
  // stay visible, including when they pass the platform or cease reporting.
  setStable(old=>reconcileNeighbours(old,incoming,updatedAt,!loading,Date.now()));
 },[data,updatedAt,loading]);
 if(data?.ownSchedule)lastOwn.current=data;
 const ownData=data?.ownSchedule?data:lastOwn.current;
 const ownSchedule=ownData?.ownSchedule??'';
 const ownSeconds=scheduledSeconds(ownSchedule);
 const ownDelay=ownData?.ownDelay??null;
 const service=(entry:(typeof stable.entries)[number])=>{
  const row=entry.row;
  const difference=ownSeconds!==null&&ownDelay!==null&&row.delay!==null?
   row.scheduledSeconds+row.delay-(ownSeconds+ownDelay):null;
  const stale=entry.missingCycles>0;
  const previous=colours.current.get(row.tripId)??'neutral';
  const tone=stale?'neutral':colourOrder?
   orderColour(row.relative,difference,tolerance,previous,hysteresis):'neutral';
  if(!stale)colours.current.set(row.tripId,tone);
  return <div className="sn-row" key={row.tripId}>
   <span className={'sn-arrow sn-arrow-'+row.relative} aria-label={
    row.relative==='before'?'Patří před tebe':row.relative==='after'?'Patří za tebe':'Stejný čas dle JŘ'
   }>{row.relative==='before'?'↑':row.relative==='after'?'↓':'→'}</span>
   <span className="sn-badge">{row.line}/{row.order}</span>
   <span className="sn-vehicle">{row.vehicle?'#'+row.vehicle:'—'}</span>
   <span className={'sn-delay sn-tone-'+tone+(stale?' sn-stale':'')}
    title={stale?'Poslední známá odchylka; spoj zůstává podle JŘ':
     tone==='good'?'Odhadované pořadí odpovídá JŘ':
     tone==='risk'?'Odhadované pořadí se může obrátit':
     tone==='uncertain'?'Příjezdy jsou časově blízko':'Aktuální odchylka'}>
    {formatNeighbourDelay(row.delay)}
   </span>
   <time className="sn-time" title="Čas podle jízdního řádu">{row.scheduled.slice(0,5)}</time>
  </div>;
 };
 const own=<div className="sn-row sn-own" key="own" aria-label="Tvůj spoj">
  <span className="sn-arrow sn-arrow-same">→</span>
  <span className="sn-badge">{ownLine}/{ownOrder}</span>
  <span className="sn-vehicle">{ownVehicle?'#'+ownVehicle:'—'}</span>
  <span className="sn-delay sn-tone-neutral">{ownDelay===null?'—':formatNeighbourDelay(ownDelay)}</span>
  <time className="sn-time">{ownSchedule.slice(0,5)||'—'}</time>
 </div>;
 const before=stable.entries.filter(x=>x.row.relative==='before');
 const same=stable.entries.filter(x=>x.row.relative==='same');
 const after=stable.entries.filter(x=>x.row.relative==='after');
 return <div className="sn-panel" aria-label="Okolní spoje na stejné nástupní hraně">
  {stable.entries.length?<div className="sn-rows">{before.map(service)}{own}{same.map(service)}{after.map(service)}</div>:
   <p className="sn-status">{error?'Online údaje nejsou dostupné':loading?'Načítám okolní spoje…':'Žádné blízké spoje'}</p>}
 </div>;
}
