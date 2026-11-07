import type {Stop} from './tripData.ts';
import type {NeighbourResult} from './stopNeighbours.ts';

/**
 * A platform can occur more than once in a trip (loops/repeated stops).
 * The saved row set therefore belongs to an exact occurrence, not merely
 * to a public-facing stop name or shared GTFS stop_id.
 */
export function neighbourStopIdentity(tripId:string,index:number|null,stop:Stop|null):string{
 if(index===null||!stop)return tripId+'|unselected';
 return [tripId,index,stop.id,stop.arrival||stop.departure].join('|');
}
/** Never hand a panel results from a different stop while an async request changes target. */
export function neighbourResultMatchesStop(data:NeighbourResult|null,stop:Stop|null):boolean{
 if(!data||!stop||!data.stopId||!stop.id)return false;
 const expected=stop.arrival||stop.departure;
 return data.stopId===stop.id&&data.ownSchedule===expected;
}
