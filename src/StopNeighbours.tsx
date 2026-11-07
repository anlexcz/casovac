import type {NeighbourResult,NeighbourRow} from './stopNeighbours.ts';
import {formatNeighbourDelay} from './stopNeighbours.ts';
import './stopNeighbours.css';

type Props={data:NeighbourResult|null;loading:boolean;error:string;
 ownLine:string;ownOrder:string;ownVehicle:string};
export default function StopNeighbours({data,loading,error,ownLine,ownOrder,ownVehicle}:Props){
 const rows=data?.rows??[];
 const ownTime=data?.ownSchedule.slice(0,5)||'—';
 // A plain integrated timetable: no headers, no nested cards, no textual
 // group titles. Exact service order is always defined by scheduled time.
 const service=(row:NeighbourRow)=><div className="sn-row" key={row.tripId}>
  <span className={"sn-arrow sn-arrow-"+row.relative} aria-label={row.relative==='before'?'Patří před tebe':row.relative==='after'?'Patří za tebe':'Shodný čas podle JŘ'}>
   {row.relative==='before'?'↑':row.relative==='after'?'↓':'→'}
  </span>
  <span className="sn-badge">{row.line}/{row.order}</span>
  <span className="sn-vehicle">{row.vehicle?'#'+row.vehicle:'—'}</span>
  <span className="sn-delay" title="Odchylka vůči jízdnímu řádu">{formatNeighbourDelay(row.delay)}</span>
  <time className="sn-time" title="Plánovaný čas">{row.scheduled.slice(0,5)}</time>
 </div>;
 const own=<div className="sn-row sn-own" key="own" aria-label="Tvůj spoj">
  <span className="sn-arrow sn-arrow-same">→</span>
  <span className="sn-badge">{ownLine}/{ownOrder}</span>
  <span className="sn-vehicle">{ownVehicle?'#'+ownVehicle:'—'}</span>
  <span className="sn-delay">{data?.ownDelay===null||data?.ownDelay===undefined?'—':formatNeighbourDelay(data.ownDelay)}</span>
  <time className="sn-time">{ownTime}</time>
 </div>;
 const before=rows.filter(x=>x.relative==='before');
 const same=rows.filter(x=>x.relative==='same');
 const after=rows.filter(x=>x.relative==='after');
 return <div className="sn-panel" aria-label="Okolní spoje na stejné nástupní hraně">
  {rows.length>0?<div className="sn-rows">{before.map(service)}{own}{same.map(service)}{after.map(service)}</div>:
   <p className="sn-status">{error?'Online údaje nejsou dostupné':loading?'Načítám okolní spoje…':'Žádné blízké spoje'}</p>}
  {loading&&rows.length>0&&<span className="sn-updating" aria-label="Aktualizuji okolní spoje">↻</span>}
 </div>;
}
