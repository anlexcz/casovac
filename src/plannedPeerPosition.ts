/** Exact trip lookup: identity and freshness checks independent of React/API. */
import {observationTimestamp} from './remoteTracking.ts';
import {routeOf,selectedTripId,stateOfFeature} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import type {PlannedPeer} from './plannedHeadways.ts';

export const tripPositionUrl=(id:string)=>
 'https://api.golemio.cz/v2/vehiclepositions/'+encodeURIComponent(id)+'?includeNotTracking=true';

export function exactTripPosition(payload:unknown,peer:PlannedPeer):Feature|null{
 if(!payload||typeof payload!=='object')return null;
 const object=payload as {features?:unknown;properties?:unknown};
 const candidates=Array.isArray(object.features)?object.features:[payload];
 if(candidates.length!==1)return null;
 const candidate=candidates[0];
 if(!candidate||typeof candidate!=='object'||!('properties' in candidate))return null;
 const feature=candidate as Feature;
 return selectedTripId(feature)===peer.tripId&&routeOf(feature)===peer.line?feature:null;
}
export function freshTripPosition(feature:Feature,now:number):boolean{
 const timestamp=observationTimestamp(feature);
 return timestamp!==null&&timestamp<=now+10000&&now-timestamp<=90000&&
  (stateOfFeature(feature)==='on_track'||stateOfFeature(feature)==='at_stop');
}
