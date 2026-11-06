import {path,routeOf,selectedTripId,vehicleId,stateOfFeature} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import type {Stop} from './tripData.ts';

export type LineHeadways={aheadSeconds:number|null;behindSeconds:number|null;checkedAt:number;matched:number};
export const EMPTY_HEADWAYS:LineHeadways={aheadSeconds:null,behindSeconds:null,checkedAt:0,matched:0};

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
export function headwayEligiblePeers(
 selected:Feature|null,features:Feature[],stops:Stop[],now:number,limit=16
):Feature[]{
 if(!selected||!stops.length||!live(selected,now))return [];
 const ownId=selectedTripId(selected),car=vehicleId(selected);
 const ids=new Set(stops.map(s=>s.id).filter(Boolean));
 const currentIndex=indexOfUnique(stops,stopId(selected));
 if(currentIndex<0)return [];
 return features.filter(f=>f!==selected&&routeOf(f)===routeOf(selected)&&
  selectedTripId(f)!==ownId&&vehicleId(f)!==car&&live(f,now)&&
  ids.has(stopId(f))&&nextEta(f)!==null)
  .sort((a,b)=>{
   // Prioritize vehicles close to our position, on either side.
   const indexA=indexOfUnique(stops,stopId(a)),indexB=indexOfUnique(stops,stopId(b));
   return Math.abs(indexA-currentIndex)-Math.abs(indexB-currentIndex);
  }).slice(0,limit);
}
/** Confirm that the two real GTFS trips traverse at least two common stops
 * in the same order near their live positions. Different headsigns alone
 * do not mean opposite directions (short-turns and chained trips).
 */
export function sharedReference(
 own:Stop[],peer:Stop[],ownNextId:string,peerNextId:string
):{ownIndex:number;peerIndex:number;ownRef:number;peerRef:number}|null{
 const ownIndex=indexOfUnique(own,ownNextId),peerIndex=indexOfUnique(peer,peerNextId);
 if(ownIndex<0||peerIndex<0)return null;
 const intersections=own.flatMap((stop,i)=>{
  const j=indexOfUnique(peer,stop.id);
  return j<0?[]:[{i,j}];
 });
 // A shared stop by itself is insufficient to prove the same direction.
 const nearby=intersections.filter(p=>Math.abs(p.i-ownIndex)<=10&&Math.abs(p.j-peerIndex)<=10);
 if(nearby.length<2)return null;
 const sorted=[...nearby].sort((a,b)=>a.i-b.i);
 if(!sorted.some((p,i)=>sorted.slice(i+1).some(q=>q.j>p.j)))return null;
 // Reject intersections in inconsistent order (loops or opposite travel).
 if(sorted.some((p,i)=>i>0&&p.j<=sorted[i-1].j))return null;
 const best=[...nearby].sort((a,b)=>Math.abs(a.i-ownIndex)-Math.abs(b.i-ownIndex)||
  Math.abs(a.j-peerIndex)-Math.abs(b.j-peerIndex))[0];
 return {ownIndex,peerIndex,ownRef:best.i,peerRef:best.j};
}
/**
 * Estimate temporal spacing at ONE shared reference stop.
 * A nearest vehicle may report a different next stop, and both may report
 * the SAME next stop. Each vehicle is projected using its own GTFS stop times.
 * No distance-based guesses and no exact headsign requirement.
 */
export function calculateLineHeadways(args:{
 selected:Feature|null;features:Feature[];stops:Stop[];
 peerStops:ReadonlyMap<string,Stop[]>;now:number;
}):LineHeadways{
 const {selected,features,stops,peerStops,now}=args;
 const result:LineHeadways={...EMPTY_HEADWAYS,checkedAt:now};
 if(!selected||stops.length<3||!live(selected,now))return result;
 const ownEta=nextEta(selected),ownNextId=stopId(selected);
 if(ownEta===null||indexOfUnique(stops,ownNextId)<0)return result;
 for(const peer of headwayEligiblePeers(selected,features,stops,now)){
  const ownTripId=selectedTripId(peer);
  const schedulePeer=peerStops.get(ownTripId);
  if(!schedulePeer?.length)continue;
  const shared=sharedReference(stops,schedulePeer,ownNextId,stopId(peer));
  if(!shared)continue;
  const peerEta=nextEta(peer);
  if(peerEta===null)continue;
  const ownNext=schedule(stops[shared.ownIndex]);
  const ownRef=schedule(stops[shared.ownRef]);
  const peerNext=schedule(schedulePeer[shared.peerIndex]);
  const peerRef=schedule(schedulePeer[shared.peerRef]);
  if(ownNext===null||ownRef===null||peerNext===null||peerRef===null)continue;
  const ownProjected=ownEta+(ownRef-ownNext)*1000;
  const peerProjected=peerEta+(peerRef-peerNext)*1000;
  const signedGap=Math.round((ownProjected-peerProjected)/1000);
  if(Math.abs(signedGap)<1||Math.abs(signedGap)>30*60)continue;
  result.matched++;
  if(signedGap>0&&(result.aheadSeconds===null||signedGap<result.aheadSeconds))
   result.aheadSeconds=signedGap;
  if(signedGap<0&&(result.behindSeconds===null||-signedGap<result.behindSeconds))
   result.behindSeconds=-signedGap;
 }
 return result;
}
export function formatHeadway(value:number|null):string{
 if(value===null)return '—';
 const seconds=Math.max(0,Math.round(value));
 return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}
