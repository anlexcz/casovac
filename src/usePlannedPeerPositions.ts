/** Two selected GTFS trips, no nearest-vehicle discovery.
 * Existing own-route snapshots are reused before requesting individual trips.
 */
import {useEffect,useMemo,useState} from 'react';
import {golemioJson} from './golemioClient.ts';
import {routeOf,selectedTripId} from './featureUtils.ts';
import {tripPositionUrl,exactTripPosition,freshTripPosition} from './plannedPeerPosition.ts';
import type {Feature} from './featureUtils.ts';
import type {PlannedHeadways,PlannedPeer} from './plannedHeadways.ts';

function existingPeer(features:Feature[],peer:PlannedPeer,now:number):Feature|null{
 const exact=features.filter(f=>selectedTripId(f)===peer.tripId&&routeOf(f)===peer.line&&
  freshTripPosition(f,now));
 return exact.length===1?exact[0]:null;
}
export type PeerPositionStatus={ahead:'existing'|'direct'|'unavailable'|'none';
 behind:'existing'|'direct'|'unavailable'|'none'};
export function usePlannedPeerPositions(args:{
 enabled:boolean;planned:PlannedHeadways;features:Feature[];token:string;now:number;
}):{features:Feature[];status:PeerPositionStatus}{
 const {enabled,planned,features,token,now}=args;
 const ready=enabled&&planned.status==='ready'&&!!token.trim();
 const ahead=ready?planned.ahead:null,behind=ready?planned.behind:null;
 const key=ready?[planned.referenceStopId,ahead?.tripId??'',behind?.tripId??'',
  ahead?.line??'',behind?.line??''].join('|'):'';
 const interval=Math.floor(now/20000);
 const [remote,setRemote]=useState<{key:string;interval:number;values:Feature[]}>({
  key:'',interval:-1,values:[]
 });
 const needed=useMemo(()=>{
  const peers=[ahead,behind].filter((p):p is PlannedPeer=>p!==null);
  return peers.filter(peer=>!existingPeer(features,peer,now));
  // Poll on Golemio's 20-second cadence; avoid rerunning for each UI tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,interval,features]);
 const neededKey=needed.map(p=>p.line+'|'+p.tripId).join(',');
 useEffect(()=>{
  if(!key){setRemote({key:'',interval:-1,values:[]});return;}
  if(!needed.length){setRemote({key,interval,values:[]});return;}
  let alive=true;
  // Individual trip endpoint, not a scan over adjacent routes or orders.
  void Promise.all(needed.map(async peer=>{
   try{
    const result=await golemioJson<unknown>(tripPositionUrl(peer.tripId),token,20000,'low');
    return exactTripPosition(result,peer);
   }catch{return null;} // 404, missing trip or throttling => PLAN only
  })).then(values=>{
   if(alive)setRemote({key,interval,values:values.filter((v):v is Feature=>v!==null)});
  });
  return()=>{alive=false;};
 // neededKey changes when the current line snapshot already contains a peer.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,interval,token,neededKey]);
 const fetched=remote.key===key&&remote.interval===interval?remote.values:[];
 const get=(peer:PlannedPeer|null)=>{
  if(!peer)return {feature:null,source:'none' as const};
  const fromSnapshot=existingPeer(features,peer,now);
  if(fromSnapshot)return {feature:fromSnapshot,source:'existing' as const};
  const fromDirect=existingPeer(fetched,peer,now);
  return fromDirect?{feature:fromDirect,source:'direct' as const}:
   {feature:null,source:'unavailable' as const};
 };
 const first=get(ahead),second=get(behind);
 return {features:[...new Set([first.feature,second.feature].filter((v):v is Feature=>v!==null))],
  status:{ahead:first.source,behind:second.source}};
}
