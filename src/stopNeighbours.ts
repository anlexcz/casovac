import type {Stop} from './tripData.ts';
import type {Feature} from './featureUtils.ts';
import {path,selectedTripId,vehicleId,routeOf,orderOf,stateOfFeature} from './featureUtils.ts';

export type NeighbourMode='off'|'important'|'all';
export type NeighbourSettings={
 enabled:boolean;mode:NeighbourMode;window:'auto'|'manual';
 beforeMinutes:number;afterMinutes:number;lookahead:number;autoOpenSeconds:number;manualCloseSeconds:number;
};
export const DEFAULT_NEIGHBOUR_SETTINGS:NeighbourSettings={
 enabled:false,mode:'important',window:'auto',beforeMinutes:3,afterMinutes:4,lookahead:4,autoOpenSeconds:90,manualCloseSeconds:60
};
export type NeighbourRow={
 tripId:string;line:string;order:string;vehicle:string;
 scheduled:string;scheduledSeconds:number;delay:number;
 relative:'before'|'same'|'after';predictedDifference:number;
 previousId:string;nextId:string;
};
export type NeighbourResult={rows:NeighbourRow[];significant:boolean;stopId:string;ownSchedule:string;ownDelay:number|null};
const serviceSeconds=(text:string):number|null=>{
 const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
 if(!m||Number(m[2])>59||Number(m[3]??0)>59)return null;
 return Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0);
};
const schedule=(stop:Stop)=>stop.arrival||stop.departure;
const delay=(f:Feature):number|null=>{
 for(const key of ['actual','last_stop_departure','last_stop_arrival']){
  const v=path(f,'properties.last_position.delay.'+key);
  if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=3600)return v;
 }
 return null;
};
export function relevantWindows(settings:NeighbourSettings,distance:number):{before:number;after:number}{
 if(settings.window==='manual')return {
  before:Math.max(0,Math.min(20,settings.beforeMinutes))*60,
  after:Math.max(0,Math.min(20,settings.afterMinutes))*60
 };
 const d=Math.max(0,distance);
 return d<=1?{before:120,after:180}:d<=3?{before:180,after:240}:
  d<=6?{before:240,after:300}:{before:300,after:360};
}
export function calculateStopNeighbours(args:{
 ownTripId:string;ownStops:Stop[];ownIndex:number;ownFeature:Feature|null;
 candidates:Feature[];candidateStops:ReadonlyMap<string,Stop[]>;
 now:number;settings:NeighbourSettings;distance:number;
}):NeighbourResult{
 const {ownTripId,ownStops,ownIndex,ownFeature,candidates,candidateStops,now,settings,distance}=args;
 const own=ownStops[ownIndex];
 const empty={rows:[],significant:false,stopId:own?.id??'',ownSchedule:own?schedule(own):'',ownDelay:null};
 if(!own?.id||!ownFeature)return empty;
 const ownTime=serviceSeconds(schedule(own)),ownDelay=delay(ownFeature);
 if(ownTime===null||ownDelay===null)return empty;
 const win=relevantWindows(settings,distance);
 const rows:NeighbourRow[]=[];
 let incomingBranch=false;
 const ownPrevious=ownStops[ownIndex-1]?.id??'';
 const seen=new Set<string>();
 for(const f of candidates){
  const id=selectedTripId(f),car=vehicleId(f),state=stateOfFeature(f);
  if(id==='—'||id===ownTripId||car===vehicleId(ownFeature)||seen.has(id))continue;
  if(!['on_track','at_stop'].includes(state))continue;
  const stamp=path(f,'properties.last_position.origin_timestamp');
  const measured=typeof stamp==='string'?Date.parse(stamp):NaN;
  if(!Number.isFinite(measured)||Math.abs(now-measured)>90000)continue;
  const peerDelay=delay(f),stops=candidateStops.get(id);
  if(peerDelay===null||!stops?.length)continue;
  // An exact platform ID is required. Name or approximate GPS is insufficient.
  const indices=stops.flatMap((s,i)=>s.id===own.id?[i]:[]);
  if(indices.length!==1)continue;
  const index=indices[0],targetTime=serviceSeconds(schedule(stops[index]));
  if(targetTime===null)continue;
  // Require the stop to be ahead of the vehicle, not passed already.
  const liveNext=String(path(f,'properties.last_position.next_stop.id')??'');
  const liveIndices=stops.flatMap((s,i)=>s.id===liveNext?[i]:[]);
  if(liveIndices.length!==1||liveIndices[0]>index)continue;
  const predictedDifference=targetTime+peerDelay-(ownTime+ownDelay);
  if(predictedDifference< -win.before||predictedDifference>win.after)continue;
  const prev=stops[index-1]?.id??'',next=stops[index+1]?.id??'';
  if(prev!==ownPrevious)incomingBranch=true;
  rows.push({
   tripId:id,line:routeOf(f),order:String(orderOf(f)??'?'),vehicle:car==='—'?'':car,
   scheduled:schedule(stops[index]),scheduledSeconds:targetTime,delay:peerDelay,
   relative:targetTime<ownTime?'before':targetTime>ownTime?'after':'same',
   predictedDifference,previousId:prev,nextId:next
  });
  seen.add(id);
 }
 rows.sort((a,b)=>a.scheduledSeconds-b.scheduledSeconds||
  a.line.localeCompare(b.line, 'cs')||a.order.localeCompare(b.order,'cs'));
 // Significance is tied to a real, near-time service using a different
 // incoming or outgoing stop, not simply to many lines sharing the platform.
 return {rows,significant:incomingBranch,stopId:own.id,ownSchedule:schedule(own),ownDelay};
}
export function formatNeighbourDelay(value:number):string{
 const abs=Math.abs(value);
 return (value<0?'−':'+')+String(Math.floor(abs/60)).padStart(2,'0')+':'+String(Math.floor(abs%60)).padStart(2,'0');
}
