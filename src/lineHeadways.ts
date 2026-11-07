import {path,routeOf,selectedTripId,vehicleId,stateOfFeature,orderOf} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import type {Stop} from './tripData.ts';
import {relevantCorridor,assessCorridor} from './headwayCorridor.ts';
import {foreignLineAtTransition} from './headwayLinkEligibility.ts';
import type {HeadwayLink} from './headwayLinkEligibility.ts';

export type HeadwayNeighbour={line:string;order:string;tripId:string;seconds:number;scheduledGap:number};
export type HeadwayDecision={line:string;order:string;tripId:string;reason:string;direction:'ahead'|'behind'|null;plannedGap:number|null};
export type LineHeadways={aheadSeconds:number|null;behindSeconds:number|null;ahead:HeadwayNeighbour|null;behind:HeadwayNeighbour|null;checkedAt:number;matched:number;decisions:HeadwayDecision[]};
export const EMPTY_HEADWAYS:LineHeadways={aheadSeconds:null,behindSeconds:null,ahead:null,behind:null,checkedAt:0,matched:0,decisions:[]};

const timestamp=(value:unknown):number|null=>{
 if(typeof value!=='string'||!value)return null;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)?parsed:null;
};
const stopSeconds=(value:string):number|null=>{
 const match=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
 if(!match||Number(match[2])>59||Number(match[3]??0)>59)return null;
 return Number(match[1])*3600+Number(match[2])*60+Number(match[3]??0);
};
const schedule=(stop:Stop):number|null=>stopSeconds(stop.arrival||stop.departure);
const stopId=(feature:Feature):string=>String(path(feature,'properties.last_position.next_stop.id')??'');
const live=(feature:Feature,now:number):boolean=>{
 const time=timestamp(path(feature,'properties.last_position.origin_timestamp'));
 return (stateOfFeature(feature)==='on_track'||stateOfFeature(feature)==='at_stop')&&
  time!==null&&Math.abs(now-time)<=90000;
};
const delaySeconds=(f:Feature):number|null=>{
 for(const field of ['actual','last_stop_departure','last_stop_arrival']){
  const value=path(f,'properties.last_position.delay.'+field);
  if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=3600)return value;
 }
 return null;
};
const nextEta=(f:Feature):number|null=>{
 const next=path(f,'properties.last_position.next_stop');
 const scheduled=timestamp(path(next,'arrival_time')??path(next,'departure_time'));
 const delay=delaySeconds(f);
 return scheduled!==null&&delay!==null?scheduled+delay*1000:null;
};
const indexOfUnique=(stops:Stop[],id:string):number=>{
 if(!id)return -1;
 const found=stops.flatMap((stop,i)=>stop.id===id?[i]:[]);
 return found.length===1?found[0]:-1;
};
const distanceSq=(a:Feature,b:Feature):number=>{
 const ac=a.geometry?.coordinates,bc=b.geometry?.coordinates;
 if(!Array.isArray(ac)||!Array.isArray(bc)||ac.length<2||bc.length<2)return Infinity;
 const ax=Number(ac[0]),ay=Number(ac[1]),bx=Number(bc[0]),by=Number(bc[1]);
 if(![ax,ay,bx,by].every(Number.isFinite))return Infinity;
 const dy=(ay-by)*111_200,dx=(ax-bx)*111_200*Math.cos(ay*Math.PI/180);
 return dy*dy+dx*dx;
};
/** The public GTFS Lookup stop list intentionally lacks stop_id. Neighbours
 * must be chosen from live vehiclepositions first, independently of that list.
 * Their full static GTFS stop sequences are resolved asynchronously.
 */
export function headwayEligiblePeers(
 selected:Feature|null,features:Feature[],_stops:Stop[],now:number,limit=64,allowedRoutes?:ReadonlySet<string>
):Feature[]{
 if(!selected||!live(selected,now))return [];
 const ownId=selectedTripId(selected),car=vehicleId(selected);
 return features.filter(f=>f!==selected&&(allowedRoutes?allowedRoutes.has(routeOf(f)):routeOf(f)===routeOf(selected))&&
  selectedTripId(f)!==ownId&&selectedTripId(f)!=='—'&&
  vehicleId(f)!==car&&live(f,now)&&!!stopId(f)&&nextEta(f)!==null)
  .sort((a,b)=>distanceSq(a,selected)-distanceSq(b,selected))
  .slice(0,limit);
}
/** Confirm that the two real GTFS trips traverse at least two common stops
 * in the same order near their live positions. Different headsigns alone
 * do not mean opposite directions (short-turns and chained trips).
 */
export function sharedReference(
 own:Stop[],peer:Stop[],ownNextId:string,peerNextId:string
):{ownIndex:number;peerIndex:number;ownRef:number;peerRef:number}|null{
 return relevantCorridor(own,peer,ownNextId,peerNextId);
}
/**
 * Estimate temporal spacing at ONE shared reference stop.
 * A nearest vehicle may report a different next stop, and both may report
 * the SAME next stop. Each vehicle is projected using its own GTFS stop times.
 * No distance-based guesses and no exact headsign requirement.
 */
export function calculateLineHeadways(args:{
 selected:Feature|null;features:Feature[];stops:Stop[];
 peerStops:ReadonlyMap<string,Stop[]>;now:number;allowedRoutes?:ReadonlySet<string>;
 links?:ReadonlyMap<string,HeadwayLink>;
}):LineHeadways{
 const {selected,features,stops,peerStops,now,allowedRoutes,links}=args;
 const ownStops=peerStops.get(selected?selectedTripId(selected):'')??stops;
 const result:LineHeadways={...EMPTY_HEADWAYS,checkedAt:now,decisions:[]};
 if(!selected||ownStops.length<3||!live(selected,now))return result;
 const ownEta=nextEta(selected),ownNextId=stopId(selected);
 if(ownEta===null||indexOfUnique(ownStops,ownNextId)<0)return result;
 for(const peer of headwayEligiblePeers(selected,features,stops,now,64,allowedRoutes)){
  const ownTripId=selectedTripId(peer);
  const schedulePeer=peerStops.get(ownTripId);
  const note=(reason:string,direction:'ahead'|'behind'|null=null,plannedGap:number|null=null)=>{
   result.decisions.push({line:routeOf(peer),order:String(orderOf(peer)??''),tripId:ownTripId,reason,direction,plannedGap});
  };
  if(!schedulePeer?.length){note('Jízdní řád kandidáta není dostupný');continue;}
  const assessed=assessCorridor(ownStops,schedulePeer,ownNextId,stopId(peer));
  const shared=assessed.reference;
  if(!shared){note('Koridor: '+assessed.reason);continue;}
  // Different operating lines may share tracks. They count as actual
  // neighbours only across an individually verified GTFS block boundary,
  // never merely because the route was found elsewhere in a chained block.
  if(routeOf(peer)!==routeOf(selected)&&!foreignLineAtTransition({
   ownId:selectedTripId(selected),peerId:ownTripId,
   ownLine:routeOf(selected),peerLine:routeOf(peer),
   reference:shared,links:links??new Map()
  })){
   note('Jiná linka: mimo ověřenou přechodovou konečnou');
   continue;
  }
  const peerEta=nextEta(peer);
  if(peerEta===null)continue;
  const ownNext=schedule(ownStops[shared.ownIndex]);
  const ownRef=schedule(ownStops[shared.ownRef]);
  const peerNext=schedule(schedulePeer[shared.peerIndex]);
  const peerRef=schedule(schedulePeer[shared.peerRef]);
  if(ownNext===null||ownRef===null||peerNext===null||peerRef===null){note('Chybí plánovaný čas na společné zastávce');continue;}
  const ownProjected=ownEta+(ownRef-ownNext)*1000;
  const peerProjected=peerEta+(peerRef-peerNext)*1000;
  // GTFS, NEVER live prediction, determines the preceding/following vehicle.
  // Compare schedules at exactly the same shared stop. Delays cannot swap sides.
  const plannedGap=ownRef-peerRef;
  if(!plannedGap||Math.abs(plannedGap)>90*60){note('Nulový nebo příliš vzdálený plánovaný rozestup',null,plannedGap);continue;}
  const liveGap=Math.round((ownProjected-peerProjected)/1000);
  if(!Number.isFinite(liveGap)||Math.abs(liveGap)>90*60){note('Neplatný nebo příliš vzdálený živý rozestup',null,plannedGap);continue;}
  const neighbour:HeadwayNeighbour={
   line:routeOf(peer),order:String(orderOf(peer)??''),tripId:selectedTripId(peer),
   seconds:plannedGap>0?Math.max(0,liveGap):Math.max(0,-liveGap),
   scheduledGap:Math.abs(plannedGap)
  };
  // Choose the closest PLANNED neighbouring service, not the one whose live
  // delay happens to be smallest. A late predecessor remains a predecessor.
  if(plannedGap>0&&(!result.ahead||neighbour.scheduledGap<result.ahead.scheduledGap)){
   result.ahead=neighbour;
  }
  if(plannedGap<0&&(!result.behind||neighbour.scheduledGap<result.behind.scheduledGap)){
   result.behind=neighbour;
  }
  note(routeOf(peer)===routeOf(selected)?'Vhodný spoj':
   'Ověřený přeběh přes konečnou',plannedGap>0?'ahead':'behind',plannedGap);
  result.matched++;
 }
 result.aheadSeconds=result.ahead?.seconds??null;
 result.behindSeconds=result.behind?.seconds??null;
 return result;
}
export function formatHeadway(value:number|null):string{
 if(value===null)return '—';
 const seconds=Math.max(0,Math.round(value));
 return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}
