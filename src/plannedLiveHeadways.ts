/** Phase 4D: attach LIVE delay only to the exact GTFS trip selected by PLAN.
 * The planned side/identity is authoritative. A live snapshot must never
 * replace the chosen peer merely because another vehicle is closer.
 */
import {observationTimestamp} from './remoteTracking.ts';
import {orderOf,path,routeOf,selectedTripId,stateOfFeature,vehicleId} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import type {PlannedHeadways,PlannedPeer} from './plannedHeadways.ts';

export type PlannedLivePeer={seconds:number;order:string};
export type PlannedLiveHeadways={ahead:PlannedLivePeer|null;behind:PlannedLivePeer|null};
const EMPTY:PlannedLiveHeadways={ahead:null,behind:null};

function fresh(feature:Feature,now:number):boolean{
 const observed=observationTimestamp(feature);
 return observed!==null&&observed<=now+10000&&now-observed<=90000&&
  ['on_track','at_stop'].includes(stateOfFeature(feature));
}
function delay(feature:Feature):number|null{
 for(const field of ['actual','last_stop_departure','last_stop_arrival']){
  const value=path(feature,'properties.last_position.delay.'+field);
  if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=3600)return value;
 }
 return null;
}
/** If the peer has no verifiable LIVE delay, only our confirmed current delay
 * adjusts the timetable gap. This remains an estimate, never a LIVE value.
 */
export function estimatedPeerGap(args:{
 planned:PlannedPeer|null;side:'ahead'|'behind';selected:Feature|null;now:number;
}):number|null{
 const {planned,side,selected,now}=args;
 if(!planned)return null;
 const own=selected&&fresh(selected,now)?delay(selected):null;
 return Math.max(0,Math.round(planned.scheduledGap+
  (own===null?0:side==='ahead'?own:-own)));
}
export function verifiedPeerDelay(feature:Feature|null,now:number):number|null{
 return feature&&fresh(feature,now)?delay(feature):null;
}
export function resolvePlannedLiveHeadways(args:{
 planned:PlannedHeadways;selected:Feature|null;features:Feature[];now:number;
 tripIds?:{ahead:string;behind:string};
}):PlannedLiveHeadways{
 const {planned,selected,features,now,tripIds}=args;
 if(planned.status!=='ready'||!selected||!fresh(selected,now))return EMPTY;
 const ownDelay=delay(selected);
 if(ownDelay===null)return EMPTY;
 const resolve=(peer:PlannedPeer|null,side:'ahead'|'behind'):PlannedLivePeer|null=>{
  if(!peer)return null;
  const observedTrip=tripIds?.[side]||peer.tripId;
  const matches=features.filter(feature=>
   selectedTripId(feature)===observedTrip&&
   (observedTrip!==peer.tripId||routeOf(feature)===peer.line));
  if(matches.length!==1)return null;
  const feature=matches[0];
  if(!fresh(feature,now)||vehicleId(feature)==='—'||
   vehicleId(feature)===vehicleId(selected))return null;
  const otherDelay=delay(feature);
  if(otherDelay===null)return null;
  const seconds=side==='ahead'?
   peer.scheduledGap+ownDelay-otherDelay:
   peer.scheduledGap+otherDelay-ownDelay;
  return {seconds:Math.max(0,Math.round(seconds)),order:String(orderOf(feature)??'')};
 };
 return {ahead:resolve(planned.ahead,'ahead'),behind:resolve(planned.behind,'behind')};
}
