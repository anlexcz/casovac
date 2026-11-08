/** 5B automatic platform selection: static relevance + verified movement.
 * A GTFS timetable may prompt a PREVIEW, but never confirms arrival/departure.
 */
import type {Stop} from './tripData.ts';
import type {PidPlatformEncounter} from './pidStatic.ts';

export type StopEvidence={
 state:string;previousIndex:number|null;nextIndex:number|null;
 fresh:boolean;
};
export type AutoPlatformTarget={index:number;physicalId:string;kind:string};

/** Preview shortly before reaching the stop *preceding* the shared platform.
 * In a long A→B section, do not open immediately after leaving A.
 * In a short section, leave time to read the information before B.
 */
export function approachPreviewSeconds(stops:Stop[],previousIndex:number,configuredLead:number):number{
 const departure=stops[previousIndex-1]?.departure||stops[previousIndex-1]?.arrival||'';
 const arrival=stops[previousIndex]?.arrival||stops[previousIndex]?.departure||'';
 const parse=(value:string)=>{
  const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0):null;
 };
 const from=parse(departure),to=parse(arrival);
 const run=from!==null&&to!==null&&to>from?to-from:null;
 const dynamic=Math.max(12,Math.min(30,Math.round((run??80)*0.25)));
 return Math.min(Math.max(0,configuredLead),dynamic);
}
export function confirmedAtStop(e:StopEvidence,index:number):boolean{
 return e.fresh&&e.state==='at_stop'&&e.previousIndex===index;
}
export function confirmedBeyondStop(e:StopEvidence,index:number):boolean{
 return e.fresh&&(
  e.state==='on_track'&&e.nextIndex!==null&&e.nextIndex>index||
  e.state==='at_stop'&&e.previousIndex!==null&&e.previousIndex>index
 );
}
/** Select the nearest shape-verified tram junction or shared road platform that is approachable before its predecessor.
 * "tram-branch-candidate" alone must NOT trigger an automatic panel until
 * the incoming shape has been proven to use a different physical branch.
 */
export function pickAutoPlatform(args:{
 stops:Stop[];currentIndex:number|null;
 entries:PidPlatformEncounter[];stopMap:Readonly<Record<string,string>>;mode?:'important'|'all';
 evidence:StopEvidence;remainingToCurrent:number|null;remainingToTarget:(index:number)=>number|null;
 leadSeconds:number;prefetchOnly?:boolean;
}):AutoPlatformTarget|null{
 const {stops,currentIndex,entries,stopMap,evidence,remainingToCurrent,remainingToTarget,leadSeconds,mode='important',prefetchOnly=false}=args;
 if(currentIndex===null||currentIndex<0)return null;
 const eligible=new Map<number,AutoPlatformTarget>();
 for(const [sequence,physicalId,kind] of entries){
  if(kind==='shared-platform'&&mode!=='all')continue;
  if(!['mixed-confirmed','mixed-platform','tram-branch-confirmed','tram-route-set','shared-platform'].includes(kind))continue;
  const index=stops.findIndex(stop=>stop.sequence===sequence&&!!stop.id&&stopMap[stop.id]===physicalId);
  if(index<1)continue; // Cannot preview the first trip stop from a predecessor.
  eligible.set(index,{index,physicalId,kind});
 }
 for(const target of [...eligible.values()].sort((a,b)=>a.index-b.index)){
  const previous=target.index-1;
  if(confirmedBeyondStop(evidence,target.index))continue;
  // Prefetch the nearest relevant target (at most three stops ahead) well
  // before opening. Novelty requires complete trip sequences, not just LIVE.
  if(prefetchOnly){
   if(target.index>=currentIndex&&target.index<=currentIndex+3)return target;
   continue;
  }
  if(confirmedAtStop(evidence,previous))return target;
  // With a valid "at_stop" for target we still keep the active target
  // until real departure, but do not create a fresh panel late.
  if(confirmedAtStop(evidence,target.index))continue;
  const preview=approachPreviewSeconds(stops,previous,leadSeconds);
  if(previous===currentIndex&&remainingToCurrent!==null&&
   remainingToCurrent<=preview&&remainingToCurrent>=-15)return target;
  // Display index may already point at target while approaching it;
  // recover safely without assuming arrival from timetable alone.
  if(target.index===currentIndex&&evidence.fresh&&
   evidence.state==='on_track'&&evidence.nextIndex===target.index&&
   remainingToTarget(target.index)!==null&&remainingToTarget(target.index)!>0)return target;
 }
 return null;
}

/** Lightweight stop-list markers; no LIVE query and never a conflict claim. */
export type PlatformMarker='join'|'mixed'|'shared';
export function platformMarkers(
 stops:Stop[],entries:PidPlatformEncounter[],stopMap:Readonly<Record<string,string>>
):Record<number,PlatformMarker>{
 const markers:Record<number,PlatformMarker>={};
 const rank={join:3,mixed:2,shared:1};
 for(const [sequence,physical,kind] of entries){
  const index=stops.findIndex(s=>s.sequence===sequence&&!!s.id&&stopMap[s.id]===physical);
  if(index<0)continue;
  const next:PlatformMarker=kind==='tram-route-set'||kind==='tram-branch-confirmed'?'join':
   kind==='mixed-platform'||kind==='mixed-confirmed'?'mixed':'shared';
  if(!markers[index]||rank[next]>rank[markers[index]])markers[index]=next;
 }
 return markers;
}
