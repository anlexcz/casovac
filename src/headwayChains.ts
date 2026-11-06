import {validBlockBoundary} from './blockPair.ts';
import {parseStops} from './tripData.ts';
import type {Stop} from './tripData.ts';

export type HeadwayTripDetail={
 trip_id?:string;block_id?:string|null;route?:{route_short_name?:string};
 stop_times?:unknown;
};
export type LinkedSchedule={stops:Stop[];firstId:string;secondId:string;blockId:string};

/** Only join different lines with exact GTFS block identity AND a valid
 * time/stop boundary. An observed vehicle or matching order is not proof.
 */
export function joinHeadwayBlock(
 active:HeadwayTripDetail,other:HeadwayTripDetail
):LinkedSchedule|null{
 const aid=active.trip_id,bid=other.trip_id;
 if(!aid||!bid||aid===bid||!active.block_id||active.block_id!==other.block_id||
  !active.route?.route_short_name||!other.route?.route_short_name||
  active.route.route_short_name===other.route.route_short_name)return null;
 const a=parseStops(active),b=parseStops(other);
 if(validBlockBoundary(a,b))return {
  stops:[...a,...b.slice(1)],firstId:aid,secondId:bid,blockId:active.block_id
 };
 if(validBlockBoundary(b,a))return {
  stops:[...b,...a.slice(1)],firstId:bid,secondId:aid,blockId:active.block_id
 };
 return null;
}

/** GTFS list endpoint may include hundreds of unrelated trips. Only exact
 * block_id, route and unique verified stop boundary may form a successor.
 */
export function possibleBlockPartners(
 trip:HeadwayTripDetail,items:HeadwayTripDetail[],otherLine:string
):string[]{
 if(!trip.block_id||!trip.trip_id)return [];
 return [...new Set(items.filter(item=>
  item.trip_id&&item.trip_id!==trip.trip_id&&item.block_id===trip.block_id&&
  (!item.route||item.route.route_short_name===otherLine)
 ).map(item=>item.trip_id!))];
}
