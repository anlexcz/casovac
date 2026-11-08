/** Operational visibility of a *planned duty*, not of one temporary trip ID.
 * This is a display gate. A missing LIVE observation cannot prove arrival.
 */
import {serviceSeconds} from './headwayPeerLocation.ts';
import {path,stateOfFeature} from './featureUtils.ts';
import {freshTripPosition} from './plannedPeerPosition.ts';
import type {DutyTrip} from './peerDutyContinuity.ts';
import type {Feature} from './featureUtils.ts';

export type DutyPhase='unknown'|'before-service'|'running'|'terminal-wait'|'after-service';
export function dutyPhase(args:{
 candidates:DutyTrip[];date:string;now:number;feature?:Feature|null;
}):DutyPhase{
 const {candidates,date,now,feature}=args;
 if(!candidates.length)return 'unknown';
 const clock=serviceSeconds(date,now);
 if(clock===null)return 'unknown';
 const trips=[...candidates].sort((a,b)=>a.startSeconds-b.startSeconds);
 const first=trips[0],last=trips[trips.length-1];
 const live=feature&&freshTripPosition(feature,now)?feature:null;
 if(clock<first.startSeconds-30&&!live)return 'before-service';
 const lastEnd=last.endSeconds;
 if(lastEnd!==undefined&&clock>lastEnd+30&&!live)return 'after-service';
 if(live&&stateOfFeature(live)==='at_stop'){
  const trip=trips.find(item=>item.tripId===String(path(live,
   'properties.trip.gtfs.trip_id')??''));
  const at=String(path(live,'properties.last_position.last_stop.id')??
   path(live,'properties.last_position.next_stop.id')??'');
  if(trip?.terminalStopId&&trip.terminalStopId===at){
   const next=trips.find(item=>item.startSeconds>trip.startSeconds);
   if(!next||clock<next.startSeconds)return 'terminal-wait';
  }
 }
 // An ended scheduled trip with a later verified block continuation is
 // a terminal layover, not the end of the tracked planned duty.
 const upcoming=trips.find(trip=>trip.startSeconds>clock+30);
 const completed=trips.some(trip=>trip.endSeconds!==undefined&&
  trip.endSeconds<=clock&&trip.startSeconds<=clock);
 if(upcoming&&completed&&!live)return 'terminal-wait';
 return 'running';
}
export function displayDutyPhase(phase:DutyPhase):boolean{
 return phase!=='before-service'&&phase!=='terminal-wait'&&phase!=='after-service';
}
