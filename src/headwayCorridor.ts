import type {Stop} from './tripData.ts';

export type CorridorReference={
 ownIndex:number;peerIndex:number;ownRef:number;peerRef:number;
 startOwn:number;endOwn:number;startPeer:number;endPeer:number;
};

/**
 * Find the shared, directionally ordered service corridor, not merely any
 * two common stops anywhere in the trips. Stop IDs must identify unique
 * occurrences; loops with ambiguous repeated platforms are not guessed.
 */
export type CorridorReason='ok'|'missing-stop'|'no-shared-direction'|'own-before-corridor'|'own-past-corridor'|'peer-past-corridor'|'no-current-corridor';
export type CorridorAssessment={reference:CorridorReference|null;reason:CorridorReason};

export function assessCorridor(
 own:Stop[],peer:Stop[],ownNextId:string,peerNextId:string
):CorridorAssessment{
 const uniqueIndex=(items:Stop[],id:string):number=>{
  if(!id)return -1;
  let index=-1;
  for(let i=0;i<items.length;i++){
   if(items[i].id!==id)continue;
   if(index>=0)return -1;
   index=i;
  }
  return index;
 };
 const ownIndex=uniqueIndex(own,ownNextId);
 const peerIndex=uniqueIndex(peer,peerNextId);
 if(ownIndex<0||peerIndex<0)return {reference:null,reason:'missing-stop'};
 const matches=own.flatMap((stop,i)=>{
  const j=uniqueIndex(peer,stop.id);
  return stop.id&&j>=0?[{i,j}]:[];
 }).sort((a,b)=>a.i-b.i);
 // Divide the intersections into coherent, forward-running corridors.
 // A short skipped stop is allowed, but not a remote later crossing.
 const runs:{i:number;j:number}[][]=[];
 let current:{i:number;j:number}[]=[];
 for(const point of matches){
  const prev=current[current.length-1];
  if(prev&&(point.j<=prev.j||point.i-prev.i>4||point.j-prev.j>4)){
   if(current.length>=2)runs.push(current);
   current=[];
  }
  current.push(point);
 }
 if(current.length>=2)runs.push(current);
 const candidates=runs.filter(run=>{
  const start=run[0],end=run[run.length-1];
  // Our next stop must lie on the shared corridor. A corridor that begins
  // later is not a useful current headway.
  if(ownIndex<start.i||ownIndex>end.i)return false;
  // Once the other vehicle has departed the shared section it is ineligible.
  // Earlier vehicles may approach it via their verified virtual trip.
  if(peerIndex>end.j)return false;
  // Both vehicles must be sufficiently close to a shared stop occurrence.
  return run.some(x=>Math.abs(x.i-ownIndex)<=4)&&
   (peerIndex<start.j||run.some(x=>Math.abs(x.j-peerIndex)<=4));
 });
 if(!candidates.length){
  if(!runs.length)return {reference:null,reason:'no-shared-direction'};
  if(runs.every(run=>ownIndex<run[0].i))return {reference:null,reason:'own-before-corridor'};
  if(runs.every(run=>ownIndex>run[run.length-1].i))return {reference:null,reason:'own-past-corridor'};
  if(runs.some(run=>ownIndex>=run[0].i&&ownIndex<=run[run.length-1].i&&peerIndex>run[run.length-1].j))return {reference:null,reason:'peer-past-corridor'};
  return {reference:null,reason:'no-current-corridor'};
 }
 const best=candidates.sort((a,b)=>{
  const distance=(run:{i:number;j:number}[])=>
   Math.min(...run.map(x=>Math.abs(x.i-ownIndex)))+
   Math.min(...run.map(x=>Math.abs(x.j-peerIndex)));
  return distance(a)-distance(b)||b.length-a.length;
 })[0];
 const anchor=best.reduce((p,x)=>
  Math.abs(x.i-ownIndex)<Math.abs(p.i-ownIndex)?x:p,best[0]);
 return {reason:'ok',reference:{
  ownIndex,peerIndex,ownRef:anchor.i,peerRef:anchor.j,
  startOwn:best[0].i,endOwn:best[best.length-1].i,
  startPeer:best[0].j,endPeer:best[best.length-1].j
 }};
}

export function relevantCorridor(own:Stop[],peer:Stop[],ownNextId:string,peerNextId:string):CorridorReference|null{
 return assessCorridor(own,peer,ownNextId,peerNextId).reference;
}
