import {path,routeOf,selectedTripId,vehicleId,stateOfFeature} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import type {Stop} from './tripData.ts';

export type LineHeadways={aheadSeconds:number|null;behindSeconds:number|null;checkedAt:number;matched:number};
export const EMPTY_HEADWAYS:LineHeadways={aheadSeconds:null,behindSeconds:null,checkedAt:0,matched:0};
const asTime=(value:unknown):number|null=>{
 if(typeof value!=='string'||!value)return null;
 const time=Date.parse(value);
 return Number.isFinite(time)?time:null;
};
const gtfsSeconds=(value:string):number|null=>{
 const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
 return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0):null;
};
const telemetryTime=(f:Feature)=>asTime(path(f,'properties.last_position.origin_timestamp'));
const predictedNext=(f:Feature):number|null=>{
 const stop=path(f,'properties.last_position.next_stop');
 const at=asTime(path(stop,'arrival_time')??path(stop,'departure_time'));
 const delay=path(f,'properties.last_position.delay.actual');
 return at===null||typeof delay!=='number'||!Number.isFinite(delay)?null:at+delay*1000;
};
const uniqueIndex=(stops:Stop[],id:string):number=>{
 if(!id)return -1;
 const hits=stops.flatMap((s,i)=>s.id===id?[i]:[]);
 return hits.length===1?hits[0]:-1;
};
/**
 * Project neighbouring trams onto one common stop using the already loaded
 * selected-trip timetable and live next_stop timestamps. No additional API calls.
 * Return null instead of guessing for stale, conflicting or branched routes.
 */
export function calculateLineHeadways(args:{
 selected:Feature|null;features:Feature[];stops:Stop[];now:number;
}):LineHeadways{
 const {selected,features,stops,now}=args;
 const result:LineHeadways={...EMPTY_HEADWAYS,checkedAt:now};
 if(!selected||stops.length<3)return result;
 const route=routeOf(selected),id=selectedTripId(selected),vehicle=vehicleId(selected);
 const direction=String(path(selected,'properties.trip.gtfs.trip_headsign')??'').trim();
 const timestamp=telemetryTime(selected);
 const ownEta=predictedNext(selected);
 const ownNextId=String(path(selected,'properties.last_position.next_stop.id')??'');
 const ownIndex=uniqueIndex(stops,ownNextId);
 if(!direction||ownIndex<0||timestamp===null||Math.abs(now-timestamp)>90000||ownEta===null||
  !['at_stop','on_track'].includes(stateOfFeature(selected)))return result;
 const reference=gtfsSeconds(stops[ownIndex].arrival||stops[ownIndex].departure);
 if(reference===null)return result;
 for(const other of features){
  if(other===selected||routeOf(other)!==route||selectedTripId(other)===id||
   vehicleId(other)===vehicle||!['at_stop','on_track'].includes(stateOfFeature(other)))continue;
  if(String(path(other,'properties.trip.gtfs.trip_headsign')??'').trim()!==direction)continue;
  const updated=telemetryTime(other),eta=predictedNext(other);
  const otherId=String(path(other,'properties.last_position.next_stop.id')??'');
  const otherIndex=uniqueIndex(stops,otherId);
  if(otherIndex<0||otherIndex===ownIndex||updated===null||Math.abs(now-updated)>90000||eta===null)continue;
  const otherSchedule=gtfsSeconds(stops[otherIndex].arrival||stops[otherIndex].departure);
  if(otherSchedule===null)continue;
  // Compare the same location, not physical distance or raw arrival times at
  // two different stops. Offsets use current route's stop-to-stop travel times.
  const projected=eta+(reference-otherSchedule)*1000;
  const gap=Math.round(Math.abs(ownEta-projected)/1000);
  if(gap<=0||gap>30*60)continue;
  if(otherIndex>ownIndex&&projected>=ownEta)continue;
  if(otherIndex<ownIndex&&projected<=ownEta)continue;
  result.matched++;
  if(otherIndex>ownIndex&&(result.aheadSeconds===null||gap<result.aheadSeconds))result.aheadSeconds=gap;
  if(otherIndex<ownIndex&&(result.behindSeconds===null||gap<result.behindSeconds))result.behindSeconds=gap;
 }
 return result;
}
export function formatHeadway(value:number|null):string{
 if(value===null)return '—';
 const seconds=Math.max(0,Math.round(value));
 return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}
