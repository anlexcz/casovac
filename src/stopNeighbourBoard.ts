import type {Stop} from './tripData.ts';
import type {NeighbourResult,NeighbourSettings} from './stopNeighbours.ts';
import type {Feature} from './featureUtils.ts';
import {selectedTripId,vehicleId,orderOf} from './featureUtils.ts';
import {relevantWindows} from './stopNeighbours.ts';

type BoardDeparture={
 trip?:{id?:string;is_canceled?:boolean};
 route?:{short_name?:string;type?:number};
 stop?:{id?:string};
 arrival_timestamp?:{scheduled?:string|null};
 departure_timestamp?:{scheduled?:string|null};
 delay?:{is_available?:boolean;seconds?:number|null};
};
export type DepartureBoard={departures?:BoardDeparture[]};
const pragueParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',
 hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function seconds(value:string):number|null{
 const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
 return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0):null;
}
function localSeconds(iso:string):number|null{
 const date=new Date(iso);
 if(!Number.isFinite(date.getTime()))return null;
 const parts=pragueParts.formatToParts(date),get=(type:string)=>Number(parts.find(p=>p.type===type)?.value??0);
 return get('hour')*3600+get('minute')*60+get('second');
}
function alignDay(serviceTime:number,localTime:number):number{
 const choices=[localTime-86400,localTime,localTime+86400,localTime+172800];
 return choices.sort((a,b)=>Math.abs(a-serviceTime)-Math.abs(b-serviceTime))[0];
}
export function departureBoardUrl(ids:string[]):string{
 const url=new URL('https://api.golemio.cz/v2/pid/departureboards');
 for(const id of [...new Set(ids.filter(Boolean))])url.searchParams.append('ids[]',id);
 url.searchParams.set('minutesBefore','20');
 url.searchParams.set('minutesAfter','60');
 url.searchParams.set('order','timetable');
 url.searchParams.set('mode','mixed');
 url.searchParams.set('filter','none');
 url.searchParams.set('limit','200');
 return url.toString();
}
export function parseNeighbourBoard(args:{
 board:DepartureBoard;stop:Stop;ownTripId:string;ownStops:Stop[];
 ownIndex:number;ownDelay:number|null;settings:NeighbourSettings;
 distance:number;features:Feature[];candidateStops?:ReadonlyMap<string,Stop[]>;
}):NeighbourResult{
 const {board,stop,ownTripId,ownStops,ownIndex,ownDelay,settings,distance,features,candidateStops}=args;
 const ownSchedule=stop.arrival||stop.departure,ownTime=seconds(ownSchedule);
 const result:NeighbourResult={rows:[],significant:false,stopId:stop.id,ownSchedule,ownDelay};
 if(ownTime===null||!stop.id)return result;
 const live=new Map(features.map(f=>[selectedTripId(f),f]));
 const window=relevantWindows(settings,distance);
 const seen=new Set<string>();
 const ownPrev=ownStops[ownIndex-1]?.id??'';
 for(const departure of board.departures??[]){
  const id=departure.trip?.id??'';
  if(!id||id===ownTripId||seen.has(id)||departure.trip?.is_canceled)continue;
  // Physical boarding edge is authoritative: never blend other directions,
  // other platforms or nearby stops just because their names match.
  if(departure.stop?.id!==stop.id)continue;
  if(departure.route?.type!==0)continue;
  const shortName=departure.route?.short_name;
  if(!shortName)continue;
  const plannedISO=departure.arrival_timestamp?.scheduled??departure.departure_timestamp?.scheduled;
  const local=plannedISO?localSeconds(plannedISO):null;
  if(local===null)continue;
  const planned=alignDay(ownTime,local);
  const liveDelay=departure.delay?.is_available&&typeof departure.delay.seconds==='number'?
   departure.delay.seconds:null;
  const diff=planned+(liveDelay??0)-(ownTime+(ownDelay??0));
  if(diff < -window.before||diff > window.after)continue;
  const feature=live.get(id);
  const car=feature?vehicleId(feature):'';
  const stops=candidateStops?.get(id);
  const matches=stops?.map((s,i)=>s.id===stop.id?i:-1).filter(i=>i>=0)??[];
  const position=matches.length===1?matches[0]:-1;
  const prev=position>=0?stops![position-1]?.id??'':'';
  const next=position>=0?stops![position+1]?.id??'':'';
  // Significance requires verified incoming branch, not merely "last stop"
  // from an older vehicle position.
  if(position>=0&&prev!==ownPrev)result.significant=true;
  result.rows.push({
   tripId:id,line:shortName,order:feature?String(orderOf(feature)??'?'):'?',
   vehicle:car==='—'?'':car,scheduled:new Date(plannedISO!).toLocaleTimeString('cs-CZ',
    {timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}),
   scheduledSeconds:planned,delay:liveDelay,
   relative:planned<ownTime?'before':planned>ownTime?'after':'same',
   predictedDifference:diff,previousId:prev,nextId:next
  });
  seen.add(id);
 }
 result.rows.sort((a,b)=>a.scheduledSeconds-b.scheduledSeconds||
  a.line.localeCompare(b.line,'cs')||a.order.localeCompare(b.order,'cs'));
 return result;
}
