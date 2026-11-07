import type {DepartureBoard} from './stopNeighbourBoard.ts';
import {departureBoardUrl} from './stopNeighbourBoard.ts';

/** Do not infer a boarding edge from a shared stop name.
 * Use a same-trip, same-scheduled-visit departure from the operator to
 * recover the authoritative GTFS stop_id omitted by trip lookup.
 */
const pragueTime=new Intl.DateTimeFormat('en-GB',{
 timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
function seconds(value:string):number|null{
 const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
 return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0):null;
}
function secondsFromISO(value:string):number|null{
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return null;
 const parts=pragueTime.formatToParts(date);
 const get=(type:string)=>Number(parts.find(x=>x.type===type)?.value??0);
 return get('hour')*3600+get('minute')*60+get('second');
}
function sameTime(a:number,b:number){
 return [-86400,0,86400,172800].some(offset=>Math.abs(a-(b+offset))<=90);
}
/**
 * Time-window anchors are *local service-day clock time*, as expected by
 * Golemio's timeFrom query. GTFS allows 24:xx, 25:xx ...; calculating via UTC
 * calendar arithmetic intentionally avoids the browser's own timezone.
 */
export function serviceBoardTimeFrom(serviceDate:string,scheduled:string,leadMinutes=10):string|null{
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(serviceDate))return null;
 const planned=seconds(scheduled);
 if(planned===null)return null;
 const start=new Date(serviceDate+'T00:00:00Z');
 if(!Number.isFinite(start.getTime()))return null;
 start.setTime(start.getTime()+planned*1000-leadMinutes*60000);
 return start.toISOString().slice(0,19);
}
export function departureBoardNameUrl(name:string,scheduled?:string,serviceDate?:string):string{
 const url=new URL(departureBoardUrl([]));
 url.searchParams.set('names',name);
 const from=scheduled&&serviceDate?serviceBoardTimeFrom(serviceDate,scheduled):null;
 if(from){
  // Target a small interval around the vehicle's OWN scheduled arrival.
  // Previously a broad station name search hit the API's first-100 result
  // cap before our own trip appeared.
  url.searchParams.set('timeFrom',from);
  url.searchParams.set('minutesBefore','0');
  url.searchParams.set('minutesAfter','40');
 }else{
  url.searchParams.set('minutesBefore','30');
  url.searchParams.set('minutesAfter','120');
 }
 return url.toString();
}
export type PlatformResolution={
 id:string;
 matches:number;
 reason:string;
};
export function resolveOwnPlatform(
 board:DepartureBoard,tripId:string,scheduled:string
):PlatformResolution{
 const target=seconds(scheduled);
 if(target===null)return {id:'',matches:0,reason:'Neplatný GTFS čas vlastního spoje'};
 const matches=(board.departures??[]).filter(dep=>{
  const iso=dep.arrival_timestamp?.scheduled??dep.departure_timestamp?.scheduled;
  const fromBoard=typeof iso==='string'?secondsFromISO(iso):null;
  return dep.trip?.id===tripId&&!!dep.stop?.id&&
   fromBoard!==null&&sameTime(target,fromBoard);
 });
 const ids=[...new Set(matches.map(dep=>dep.stop!.id!))];
 if(ids.length!==1)return {
  id:'',matches:matches.length,
  reason:ids.length>1?'Nesouhlasí nástupní hrana na více záznamech':
   'Odjezdník neobsahuje vlastní trip ve správném čase'
 };
 return {id:ids[0],matches:matches.length,
  reason:'Přesné ID ověřeno podle vlastního GTFS tripu a času JŘ'};
}
