/** Phase 4B: timetable-only neighbouring trips on a proven shared direction.
 * No vehiclepositions, delay or Golemio token is required to choose a planned
 * predecessor and successor. A distinct route is not assumed comparable just
 * because it visits the same platform (chain transitions are a later step).
 */
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine,PidDeparture,PidTripStop} from './pidStatic.ts';

type Source=Pick<PidStaticEngine,'getTripResolved'|'getTripStops'|'getDepartures'|'getRoutes'>;
export type PlannedPeer={tripId:string;line:string;order:string;scheduledGap:number;
 departureSeconds:number;referenceStopId:string};
export type PlannedHeadways={
 ahead:PlannedPeer|null;behind:PlannedPeer|null;
 status:'ready'|'unavailable';reason:string;considered:number;
 referenceStopId:string;
};
export const EMPTY_PLANNED_HEADWAYS:PlannedHeadways={
 ahead:null,behind:null,status:'unavailable',reason:'Nejsou načtená statická data.',
 considered:0,referenceStopId:''
};
const strictDay=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date);
const secs=(s:string):number|null=>{
 const m=/^(\d{2,}):(\d{2}):(\d{2})$/.exec(s);
 if(!m||Number(m[2])>59||Number(m[3])>59)return null;
 return Number(m[1])*3600+Number(m[2])*60+Number(m[3]);
};
const unique=(stops:PidTripStop[],id:string)=>{
 const indices=stops.flatMap((s,i)=>s.id===id?[i]:[]);
 return indices.length===1?indices[0]:-1;
};
const validStop=(stops:PidTripStop[],index:number,id:string,time:number):boolean=>
 index>=0&&stops[index]?.id===id&&secs(stops[index].departure)===time;
const sameDirection=(own:PidTripStop[],peer:PidTripStop[],ownIndex:number,peerIndex:number)=>{
 // Two precisely matching consecutive platforms in the same forward order.
 // Opposite-direction trips passing the same platform are not admitted.
 const next=own[ownIndex+1]?.id;
 if(!next||peerIndex+1>=peer.length)return false;
 const ownNext=unique(own,next),peerNext=unique(peer,next);
 return ownNext===ownIndex+1&&peerNext>peerIndex&&peerNext-peerIndex<=3;
};
export async function findPlannedHeadways(args:{
 tripId:string;date:string;referenceStopId:string;
 nowMs?:number;maxGapSeconds?:number;source?:Source;
}):Promise<PlannedHeadways>{
 const {tripId,date,referenceStopId,source=pidStatic,maxGapSeconds=1200,
  nowMs=Date.now()}=args;
 const unavailable=(reason:string):PlannedHeadways=>({
  ...EMPTY_PLANNED_HEADWAYS,referenceStopId,reason
 });
 if(!tripId||!strictDay(date))
  return unavailable('Chybí identita tripu nebo ověřený provozní den.');
 const own=await source.getTripResolved(tripId,date);
 if(!own||own.id!==tripId||own.date!==date)
  return unavailable('V provozním dni není potvrzen vlastní GTFS trip.');
 const [ownStops,routes]=await Promise.all([
  source.getTripStops(tripId,date,own.routeId),source.getRoutes()
 ]);
 if(!ownStops||ownStops.length!==own.stopTimes.length||!routes[own.routeId]?.[0])
  return unavailable('Vlastní jízdní řád není úplný.');
 let actualReference=referenceStopId;
 if(!actualReference){
  // A persisted verified duty can retain its GTFS trip when the live
  // vehicle disappears. Choose the next scheduled platform by Prague
  // service-day time, without asking Golemio or extrapolating any delay.
  const instant=new Date(nowMs);
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',
   year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
   second:'2-digit',hourCycle:'h23'}).formatToParts(instant);
  const pick=(type:string)=>parts.find(p=>p.type===type)?.value??'';
  const today=pick('year')+'-'+pick('month')+'-'+pick('day');
  const seconds=Number(pick('hour'))*3600+Number(pick('minute'))*60+
   Number(pick('second'));
  if(today!==date||!Number.isFinite(seconds))
   return unavailable('Bez LIVE není provozní den bezpečně ověřen.');
  const candidates=ownStops.slice(0,-1).map((s,i)=>({s,i,
   time:secs(s.departure)})).filter(entry=>entry.time!==null&&
    entry.time>=seconds-120&&entry.time<=seconds+1200);
  const nearest=candidates.sort((a,b)=>a.time!-b.time!)[0];
  if(!nearest)
   return unavailable('Bez LIVE není v blízkosti žádná plánovaná zastávka.');
  actualReference=nearest.s.id;
 }
 const all=await source.getDepartures(actualReference,date);
 const ownIndex=unique(ownStops,actualReference);
 if(ownIndex<0||ownIndex+1>=ownStops.length)
  return unavailable('Nejednoznačná nebo koncová referenční zastávka.');
 const ownSeconds=secs(ownStops[ownIndex].departure);
 if(ownSeconds===null)
  return unavailable('Není znám plánovaný odjezd vlastní tramvaje.');
 if(!all.some(d=>d.tripId===tripId&&d.routeId===own.routeId&&
  d.stopSequence===ownStops[ownIndex].sequence&&d.departureSeconds===ownSeconds))
  return unavailable('Vlastní zastavení nesouhlasí s indexem PID odjezdů.');
 // Bound candidate requests to the closest timetable departures. Include
 // same-identity exclusion and never fabricate an order from trip ID.
 const candidates=all.filter(d=>d.tripId!==tripId&&d.routeId===own.routeId&&
  d.date===date&&d.departureSeconds!==ownSeconds&&
  Math.abs(d.departureSeconds-ownSeconds)<=maxGapSeconds)
  .sort((a,b)=>Math.abs(a.departureSeconds-ownSeconds)-
    Math.abs(b.departureSeconds-ownSeconds)).slice(0,32);
 let ahead:PlannedPeer|null=null,behind:PlannedPeer|null=null,considered=0;
 let aheadTied=false,behindTied=false;
 const line=routes[own.routeId][0];
 const batches=Array.from({length:Math.ceil(candidates.length/6)},(_,i)=>
  candidates.slice(i*6,(i+1)*6));
 for(const batch of batches){
  const loaded=await Promise.all(batch.map(async (d:PidDeparture)=>{
   try{
    const trip=await source.getTripResolved(d.tripId,date);
    if(!trip||trip.id!==d.tripId||trip.date!==date||
       trip.routeId!==own.routeId)return null;
    const stops=await source.getTripStops(d.tripId,date,trip.routeId);
    if(!stops||stops.length!==trip.stopTimes.length)return null;
    const index=unique(stops,referenceStopId);
    if(!validStop(stops,index,referenceStopId,d.departureSeconds)||
       stops[index].sequence!==d.stopSequence||
       !sameDirection(ownStops,stops,ownIndex,index))return null;
    return d;
   }catch{return null;}
  }));
  for(const d of loaded){
   if(!d)continue;
   considered++;
   const diff=d.departureSeconds-ownSeconds;
   const peer:PlannedPeer={tripId:d.tripId,line,order:'',
    scheduledGap:Math.abs(diff),departureSeconds:d.departureSeconds,
    referenceStopId:actualReference};
   // Equal-gap ambiguous candidates must not be broken by arbitrary API order.
   if(diff<0){
    if(!ahead||peer.scheduledGap<ahead.scheduledGap){ahead=peer;aheadTied=false;}
    else if(peer.scheduledGap===ahead.scheduledGap)aheadTied=true;
   }
   if(diff>0){
    if(!behind||peer.scheduledGap<behind.scheduledGap){behind=peer;behindTied=false;}
    else if(peer.scheduledGap===behind.scheduledGap)behindTied=true;
   }
  }
 }
 return {ahead:aheadTied?null:ahead,behind:behindTied?null:behind,
  considered,status:'ready',referenceStopId:actualReference,
  reason:aheadTied||behindTied?'Shodné časy dvou sousedů: strana je nejednoznačná.':
  considered?'Plánované sousedství ověřeno z PID GTFS.':
   'Na ověřeném směrovém úseku není blízký plánovaný spoj.'};
}
