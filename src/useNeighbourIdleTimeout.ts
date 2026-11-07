import {useEffect,useRef,useState} from 'react';

/** A manual sheet closes after inactivity; time in background tabs does not count. */
export function useNeighbourIdleTimeout(
 active:boolean,key:string,seconds:number,onExpire:()=>void
){
 const [remaining,setRemaining]=useState<number|null>(null);
 const last=useRef(Date.now());
 const expired=useRef(false);
 const expireRef=useRef(onExpire);
 expireRef.current=onExpire;
 const reset=()=>{
  if(!active||seconds<=0)return;
  last.current=Date.now();
  expired.current=false;
  setRemaining(seconds);
 };
 useEffect(()=>{
  if(!active||seconds<=0){setRemaining(null);return;}
  expired.current=false;
  last.current=Date.now();
  setRemaining(seconds);
  const tick=()=>{
   const current=Date.now();
   if(document.hidden){last.current=current;return;}
   const elapsed=Math.max(0,(current-last.current)/1000);
   last.current=current;
   setRemaining(old=>{
    if(old===null)return seconds;
    const next=Math.max(0,old-elapsed);
    if(next<=0&&!expired.current){
     expired.current=true;
     // Never call the parent's state setter during a child state updater.
     queueMicrotask(()=>expireRef.current());
    }
    return next;
   });
  };
  const interval=window.setInterval(tick,1000);
  const visibility=()=>{last.current=Date.now();};
  document.addEventListener('visibilitychange',visibility);
  return()=>{window.clearInterval(interval);document.removeEventListener('visibilitychange',visibility);};
 },[active,key,seconds]);
 return {remaining,reset};
}
