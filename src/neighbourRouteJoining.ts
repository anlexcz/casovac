import type {Stop} from './tripData.ts';

const normalized=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLocaleLowerCase('cs-CZ').replace(/\s+/g,' ').trim();
const at=(stops:Stop[],idx:number)=>idx>=0&&idx<stops.length?stops[idx]:null;
const equivalent=(a:Stop|null,b:Stop|null):boolean=>{
 if(!a||!b)return false;
 if(a.id&&b.id)return a.id===b.id;
 // Public /v2/public/gtfs/trips returns stop-times with names and
 // coordinates but no stop_id. Names are useful only for the *route*
 // comparison, never to assign a platform identifier.
 if(normalized(a.name)!==normalized(b.name))return false;
 if(a.lat!==null&&a.lon!==null&&b.lat!==null&&b.lon!==null){
  const lat=(a.lat+b.lat)/2*Math.PI/180;
  const dx=(a.lon-b.lon)*Math.cos(lat)*111320;
  const dy=(a.lat-b.lat)*111320;
  return Math.hypot(dx,dy)<180;
 }
 return true;
};
const clock=(text:string):number|null=>{
 const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
 return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0):null;
};
export type JoiningDecision={
 joining:boolean;reason:'joining'|'same-incoming'|'different-outgoing'|
 'missing-route'|'ambiguous-stop'|'no-own-corridor';
};
/** Important means an actual incoming branch merging into our direction,
 * not a line leaving our route at a divergence. Unverified data is not
 * grounds for automatically opening the sheet.
 */
export function joiningCorridor(
 ownStops:Stop[],ownIndex:number,peerStops:Stop[],
 peerScheduledSeconds:number,ownPlatformId:string
):JoiningDecision{
 const prev=at(ownStops,ownIndex-1),next=at(ownStops,ownIndex+1),target=at(ownStops,ownIndex);
 if(!prev||!next||!target)return {joining:false,reason:'no-own-corridor'};
 if(!peerStops.length)return {joining:false,reason:'missing-route'};
 const matches=peerStops.flatMap((s,i)=>{
  if(ownPlatformId&&s.id&&s.id!==ownPlatformId)return [];
  if(!equivalent(s,target))return [];
  const t=clock(s.arrival||s.departure);
  if(t===null||Math.abs(t-peerScheduledSeconds)>90)return [];
  return [i];
 });
 if(matches.length!==1)return {joining:false,reason:'ambiguous-stop'};
 const i=matches[0];
 const peerPrev=at(peerStops,i-1),peerNext=at(peerStops,i+1);
 if(!peerPrev||!peerNext)return {joining:false,reason:'missing-route'};
 if(!equivalent(peerNext,next))return {joining:false,reason:'different-outgoing'};
 if(equivalent(peerPrev,prev))return {joining:false,reason:'same-incoming'};
 return {joining:true,reason:'joining'};
}
