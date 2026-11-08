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
 entries:PidPlatformEncounter[];stopMap:Readonly<Record<string,string>>;
 evidence:StopEvidence;remainingToCurrent:number|null;remainingToTarget:(index:number)=>number|null;
 leadSeconds:number;
}):AutoPlatformTarget|null{
 const {stops,currentIndex,entries,stopMap,evidence,remainingToCurrent,remainingToTarget,leadSeconds}=args;
 if(currentIndex===null||currentIndex<0)return null;
 const eligible=new Map<number,AutoPlatformTarget>();
 for(const [sequence,physicalId,kind] of entries){
  if(kind!=='mixed-confirmed'&&kind!=='mixed-platform'&&kind!=='tram-branch-confirmed')continue;
  const index=stops.findIndex(stop=>stop.sequence===sequence&&!!stop.id&&stopMap[stop.id]===physicalId);
  if(index<1)continue; // Cannot preview the first trip stop from a predecessor.
  eligible.set(index,{index,physicalId,kind});
 }
 for(const target of [...eligible.values()].sort((a,b)=>a.index-b.index)){
  const previous=target.index-1;
  if(confirmedBeyondStop(evidence,target.index))continue;
  if(confirmedAtStop(evidence,previous))return target;
  // With a valid "at_stop" for target we still keep the active target
  // until real departure, but do not create a fresh panel late.
  if(confirmedAtStop(evidence,target.index))continue;
  if(previous===currentIndex&&remainingToCurrent!==null&&
   remainingToCurrent<=leadSeconds&&remainingToCurrent>=-90)return target;
  // Display index may already point at target while approaching it;
  // recover safely without assuming arrival from timetable alone.
  if(target.index===currentIndex&&evidence.fresh&&
   evidence.state==='on_track'&&evidence.nextIndex===target.index&&
   remainingToTarget(target.index)!==null&&remainingToTarget(target.index)!>0)return target;
 }
 return null;
}
