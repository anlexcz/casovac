import {useEffect,useState} from 'react';
import {pidStatic} from './pidStatic.ts';
import type {PidPlatformEncounter} from './pidStatic.ts';

/** Read the prebuilt, checksummed per-day index once per active trip.
 * Never guess a branch or physical platform from a name or GPS position.
 */
export function useAutoPlatformPlan(tripId:string,date:string,enabled:boolean){
 const key=enabled&&tripId&&tripId!=='—'&&date?date+'|'+tripId:'';
 const [state,setState]=useState<{key:string;entries:PidPlatformEncounter[];
  stopMap:Record<string,string>;ready:boolean}>({key:'',entries:[],stopMap:{},ready:false});
 useEffect(()=>{
  if(!key)return;
  let active=true;
  void Promise.all([
   pidStatic.getPlatformEncounters(tripId,date),
   pidStatic.getStopMap()
  ]).then(([entries,stopMap])=>{
   if(active)setState({key,entries,stopMap,ready:true});
  }).catch(()=>{
   // Old/offline releases may lack 5B metadata. Stay manual-only rather than
   // opening falsely on name-matched or guessed physical edges.
   if(active)setState({key,entries:[],stopMap:{},ready:false});
  });
  return()=>{active=false;};
 },[key,tripId,date]);
 return {ready:state.key===key&&state.ready,
  entries:state.key===key?state.entries:[],
  stopMap:state.key===key?state.stopMap:{}};
}
