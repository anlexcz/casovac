import type {Stop} from './tripData';
import {sameTransitionStop} from './terminalMatch';
export type ContinuousStop={stop:Stop;index:number;continuation:boolean};
export function continuousStops(current:Stop[],next:Stop[]|null,verified:boolean):ContinuousStop[]{
 const base=current.map((stop,index)=>({stop,index,continuation:false}));
 if(!verified||!next?.length||!current.length)return base;
 // Both trip schedules share the boundary stop; show it only once.
 const last=current[current.length-1],first=next[0];
 if(!sameTransitionStop(last,first))return base;
 return base.concat(next.slice(1).map((stop,i)=>({
  stop,index:current.length+i,continuation:true
 })));
}
