/** Timetable and verified LIVE position of one exact PID GTFS trip.
 * Planned location is intentionally independent of the selected driver's delay.
 */
import {path,stateOfFeature} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import type {PidTripStop} from './pidStatic.ts';

export type PeerLocation={title:string;detail:string};
const timeSeconds=(time:string):number|null=>{
 const match=/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(time);
 if(!match||Number(match[2])>59||Number(match[3]??0)>59)return null;
 return Number(match[1])*3600+Number(match[2])*60+Number(match[3]??0);
};
const dayIndex=(date:string):number|null=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const [y,m,d]=date.split('-').map(Number);
 const stamp=Date.UTC(y,m-1,d),result=new Date(stamp);
 return result.getUTCFullYear()===y&&result.getUTCMonth()===m-1&&
  result.getUTCDate()===d?Math.floor(stamp/86400000):null;
};
export function serviceSeconds(date:string,now:number):number|null{
 const service=dayIndex(date);
 if(service===null)return null;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
  second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
 const field=(type:string)=>parts.find(p=>p.type===type)?.value??'';
 const current=field('year')+'-'+field('month')+'-'+field('day');
 const day=dayIndex(current);
 if(day===null)return null;
 // Keep GTFS 24:xx within the previous service day; do not use UTC midnight.
 return (day-service)*86400+Number(field('hour'))*3600+
  Number(field('minute'))*60+Number(field('second'));
}
export function plannedPeerLocation(stops:PidTripStop[]|null,date:string,
 now:number):PeerLocation|null{
 if(!stops?.length)return null;
 const current=serviceSeconds(date,now);
 if(current===null)return null;
 const times=stops.map(stop=>({
  stop,arrival:timeSeconds(stop.arrival),departure:timeSeconds(stop.departure)
 }));
 if(times.some(v=>v.arrival===null||v.departure===null))return null;
 const first=times[0],last=times[times.length-1];
 if(current<first.arrival!)return {title:'Ještě před začátkem jízdy',
  detail:'Podle JŘ začíná v zastávce '+first.stop.name};
 if(current>last.departure!)return {title:'Plánovaná jízda již skončila',
  detail:'Podle JŘ ukončil jízdu v zastávce '+last.stop.name};
 for(let i=0;i<times.length;i++){
  const here=times[i],next=times[i+1];
  if(current>=here.arrival!&&current<=here.departure!)
   return {title:'Podle JŘ: '+here.stop.name,detail:'Plánovaný pobyt v zastávce'};
  if(next&&current>here.departure!&&current<next.arrival!)
   return {title:'Podle JŘ mezi zastávkami',
    detail:here.stop.name+' → '+next.stop.name};
 }
 return {title:'Poloha podle JŘ není jednoznačná',
  detail:'Nedostatečné časové údaje nebo neobvyklé návaznosti'};
}
const bySequence=(stops:PidTripStop[],raw:unknown):PidTripStop|null=>{
 const sequence=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):NaN;
 if(!Number.isFinite(sequence))return null;
 return stops.find(stop=>stop.sequence===sequence)??null;
};
const byId=(stops:PidTripStop[],raw:unknown):PidTripStop|null=>{
 if(typeof raw!=='string'||!raw)return null;
 const match=stops.filter(stop=>stop.id===raw);
 return match.length===1?match[0]:null;
};
export function livePeerLocation(feature:Feature,stops:PidTripStop[]|null):PeerLocation|null{
 if(!stops?.length)return null;
 const state=stateOfFeature(feature);
 const last=bySequence(stops,path(feature,'properties.last_position.last_stop.sequence'))??
  byId(stops,path(feature,'properties.last_position.last_stop.id'));
 const next=bySequence(stops,path(feature,'properties.last_position.next_stop.sequence'))??
  byId(stops,path(feature,'properties.last_position.next_stop.id'));
 if(state==='at_stop'){
  const current=last??next;
  return current?{title:'Stojí v zastávce '+current.name,
   detail:next&&next.id!==current.id?'Následuje '+next.name:'Živá poloha podle Golemia'}:null;
 }
 if(state==='on_track'&&next)return {title:'Jede k zastávce '+next.name,
  detail:last?'Poslední zastávka '+last.name:'Živá poloha podle Golemia'};
 return null;
}
