import type {Stop} from './tripData.ts';
import type {NeighbourResult,NeighbourSettings} from './stopNeighbours.ts';
import type {Feature} from './featureUtils.ts';
import {selectedTripId,vehicleId,orderOf,path,routeOf,stateOfFeature} from './featureUtils.ts';
import {observationTimestamp} from './remoteTracking.ts';
import {relevantWindows} from './stopNeighbours.ts';
import {joiningCorridor} from './neighbourRouteJoining.ts';

type BoardDeparture={
 trip?:{id?:string;is_canceled?:boolean};
 route?:{short_name?:string;type?:number};
 stop?:{id?:string;platform_code?:string};
 arrival_timestamp?:{scheduled?:string|null};
 departure_timestamp?:{scheduled?:string|null};
 delay?:{is_available?:boolean;seconds?:number|null};
 scheduledSeconds?:number;stopSequence?:number;
};
export type DepartureBoard={departures?:BoardDeparture[];physicalStopIds?:string[]};
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
 now?:number;
}):NeighbourResult{
 const {board,stop,ownTripId,ownStops,ownIndex,ownDelay,settings,distance,features,candidateStops,now=Date.now()}=args;
 const ownSchedule=stop.arrival||stop.departure,ownTime=seconds(ownSchedule);
 const result:NeighbourResult={rows:[],significant:false,sharedOutgoing:false,stopId:stop.id,ownSchedule,ownDelay};
 if(ownTime===null||!stop.id)return result;
 const live=new Map(features.map(f=>[selectedTripId(f),f]));
 const window=relevantWindows(settings,distance);
 const seen=new Set<string>();
 const accepted=new Set(board.physicalStopIds?.includes(stop.id)?board.physicalStopIds:[stop.id]);

 for(const departure of board.departures??[]){
  const id=departure.trip?.id??'';
  if(!id||id===ownTripId||seen.has(id)||departure.trip?.is_canceled)continue;
  // Physical boarding edge is authoritative: never blend other directions,
  // other platforms or nearby stops just because their names match.
  if(!departure.stop?.id||!accepted.has(departure.stop.id))continue;
  if(![0,3,11].includes(departure.route?.type??-1))continue;
  const shortName=departure.route?.short_name;
  if(!shortName)continue;
  const plannedISO=departure.arrival_timestamp?.scheduled??departure.departure_timestamp?.scheduled;
  const local=plannedISO?localSeconds(plannedISO):null;
  const planned=typeof departure.scheduledSeconds==='number'&&
   Number.isFinite(departure.scheduledSeconds)?departure.scheduledSeconds:
   local===null?null:alignDay(ownTime,local);
  if(planned===null)continue;
  const candidate=live.get(id);
  const observed=candidate?observationTimestamp(candidate):null;
  const feature=candidate&&routeOf(candidate)===shortName&&observed!==null&&
   observed<=now+10000&&now-observed<=90000&&
   ['at_stop','on_track'].includes(stateOfFeature(candidate))?candidate:null;
  const rawDelay=feature?path(feature,'properties.last_position.delay.actual'):null;
  const liveDelay=typeof rawDelay==='number'&&Number.isFinite(rawDelay)&&Math.abs(rawDelay)<=7200?
   rawDelay:departure.delay?.is_available&&typeof departure.delay.seconds==='number'&&
   Number.isFinite(departure.delay.seconds)?departure.delay.seconds:null;
  // Unknown LIVE is a planned approximation, NOT a claim that delay is zero.
  const diff=planned+(liveDelay??0)-(ownTime+(ownDelay??0));
  if(diff < -window.before||diff > window.after)continue;
  if(feature&&typeof departure.stopSequence==='number'){
   const nextSeq=path(feature,'properties.last_position.next_stop.sequence');
   const next=typeof nextSeq==='number'?nextSeq:typeof nextSeq==='string'&&/^\d+$/.test(nextSeq)?
    Number(nextSeq):null;
   // Do not show an already-passed platform as an approaching conflict.
   if(next!==null&&next>departure.stopSequence)continue;
  }
  const car=feature?vehicleId(feature):'';
  const stops=candidateStops?.get(id);
  const matches=stops?.map((s,i)=>s.id===departure.stop?.id?i:-1).filter(i=>i>=0)??[];
  const position=matches.length===1?matches[0]:-1;
  const prev=position>=0?stops![position-1]?.id??'':'';
  const peerPrior=position>=0?stops![position-1]:undefined;
  const priorTime=peerPrior?seconds(peerPrior.arrival||peerPrior.departure):null;
  const next=position>=0?stops![position+1]?.id??'':'';
  // Auto-open only where a DIFFERENT incoming branch joins our corridor
  // and continues on our next segment. A divergence does not qualify.
  if(departure.route?.type===3||departure.route?.type===11){
   // Same verified physical edge: road vehicles can be relevant independently.
   result.significant=true;
   result.sharedOutgoing=true;
  }else if(stops?.length&&departure.stop?.id===stop.id){
   const direction=joiningCorridor(ownStops,ownIndex,stops,planned,stop.id);
   if(direction.joining)result.significant=true;
   if(direction.joining||direction.reason==='same-incoming')result.sharedOutgoing=true;
  }
  result.rows.push({
   tripId:id,line:shortName,order:feature?String(orderOf(feature)??'?'):'?',
   vehicle:car==='—'?'':car,scheduled:plannedISO?new Date(plannedISO).toLocaleTimeString('cs-CZ',
    {timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):
    [Math.floor(planned/3600)%24,Math.floor(planned%3600/60),planned%60].map(v=>String(v).padStart(2,'0')).join(':'),
   scheduledSeconds:planned,delay:liveDelay,
   relative:planned<ownTime?'before':planned>ownTime?'after':'same',
   predictedDifference:diff,previousId:prev,nextId:next,
   previousScheduledSeconds:priorTime
  });
  seen.add(id);
 }
 result.rows.sort((a,b)=>a.scheduledSeconds-b.scheduledSeconds||
  a.line.localeCompare(b.line,'cs')||a.order.localeCompare(b.order,'cs'));
 return result;
}
