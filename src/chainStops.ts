import type {Stop} from './tripData';
import {sameTransitionStop} from './terminalMatch.ts';
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

export type ChainBoardItem=ContinuousStop&{changeTo?:string;localIndex:number};
export type ChainBoard={stops:ChainBoardItem[];offset:number};
export function chainBoard(
 current:Stop[],
 predecessor:{line:string;stops:Stop[]}|null,
 successor:{line:string;stops:Stop[]}|null,
 activeLine:string
):ChainBoard{
 const previous=predecessor?.stops??[];
 const next=successor?.stops??[];
 if(previous.length>1&&current.length>1&&sameTransitionStop(previous[previous.length-1],current[0])){
  const offset=previous.length-1;
  const past=previous.slice(0,-1).map((stop,index):ChainBoardItem=>
   ({stop,index,localIndex:-1,continuation:false}));
  const actual=current.map((stop,i):ChainBoardItem=>({
   stop,index:i+offset,localIndex:i,continuation:false,
   ...(i===0?{changeTo:activeLine}:{})
  }));
  // The label belongs directly BEFORE the common stop, naming the new line.
  return {stops:past.concat(actual),offset};
 }
 const base=current.map((stop,index):ChainBoardItem=>({stop,index,localIndex:index,continuation:false}));
 if(next.length>1&&current.length>1&&sameTransitionStop(current[current.length-1],next[0])){
  base[base.length-1].changeTo=successor!.line;
  return {stops:base.concat(next.slice(1).map((stop,i):ChainBoardItem=>({
   stop,index:base.length+i,localIndex:-1,continuation:true
  }))),offset:0};
 }
 return {stops:base,offset:0};
}
