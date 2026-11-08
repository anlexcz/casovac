/** Monitor two scheduled peers and their verified consecutive GTFS block trips.
 * The physical vehicle is anchored by an actual observation of the original trip.
 * A GTFS block alone must never be advertised as confirmed live vehicle identity.
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import {golemioJson} from './golemioClient.ts';
import {routeOf,selectedTripId,vehicleId} from './featureUtils.ts';
import {tripPositionUrl,exactTripPosition,freshTripPosition} from './plannedPeerPosition.ts';
import {peerDutyCandidates} from './peerDutyContinuity.ts';
import type {DutyTrip} from './peerDutyContinuity.ts';
import type {Feature} from './featureUtils.ts';
import type {PlannedHeadways,PlannedPeer} from './plannedHeadways.ts';

const unique=(features:Feature[],id:string,line:string,now:number)=>{
 const found=features.filter(f=>selectedTripId(f)===id&&routeOf(f)===line&&
  freshTripPosition(f,now));
 return found.length===1?found[0]:null;
};
export type PeerPositionStatus={ahead:'existing'|'direct'|'unavailable'|'none';
 behind:'existing'|'direct'|'unavailable'|'none'};
type Side='ahead'|'behind';
type CandidateSet={key:string;ahead:DutyTrip[];behind:DutyTrip[]};
export function usePlannedPeerPositions(args:{
 enabled:boolean;planned:PlannedHeadways;features:Feature[];token:string;now:number;
 date:string;
}):{features:Feature[];status:PeerPositionStatus;tripIds:Record<Side,string>;
 updatedAt:number;loading:boolean}{
 const {enabled,planned,features,token,now,date}=args;
 const ready=enabled&&planned.status==='ready'&&!!token.trim()&&!!date;
 const ahead=ready?planned.ahead:null,behind=ready?planned.behind:null;
 const key=ready?[date,planned.referenceStopId,ahead?.tripId??'',behind?.tripId??''].join('|'):'';
 const minute=Math.floor(now/60000);
 const [candidates,setCandidates]=useState<CandidateSet>({key:'',ahead:[],behind:[]});
 const [remote,setRemote]=useState<{key:string;values:Feature[];updatedAt:number;loading:boolean}>({
  key:'',values:[],updatedAt:0,loading:false
 });
 // Preserve an observed vehicle for the lifetime of this exact scheduled peer.
 // Never map an unrelated vehicle solely because it has a successor trip ID.
 const known=useRef<Map<string,string>>(new Map());
 const anchorDay=useRef('');
 if(anchorDay.current!==date){known.current.clear();anchorDay.current=date;}
 useEffect(()=>{
  if(!key){setCandidates({key:'',ahead:[],behind:[]});return;}
  let alive=true;
  const first=(p:PlannedPeer|null):DutyTrip[]=>
   p?[{tripId:p.tripId,line:p.line,startSeconds:p.departureSeconds}]:[];
  setCandidates({key,ahead:first(ahead),behind:first(behind)});
  void Promise.all([ahead?peerDutyCandidates(ahead,date,now):Promise.resolve([]),
   behind?peerDutyCandidates(behind,date,now):Promise.resolve([])
  ]).then(([a,b])=>{
   if(alive)setCandidates({key,ahead:a.length?a:first(ahead),behind:b.length?b:first(behind)});
  }).catch(()=>{});
  return()=>{alive=false;};
 // Re-evaluate the verified duty only when the chosen peer changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key]);
 const routes=useMemo(()=>({
  ahead:candidates.key===key?candidates.ahead:[],
  behind:candidates.key===key?candidates.behind:[]
 }),[candidates,key]);
 const candidateIds=[...new Set([...routes.ahead,...routes.behind].map(p=>p.tripId))];
 const candidatesKey=candidateIds.join('|');
 const allLocal=remote.key===key?[...features,...remote.values]:features;
 const remember=(side:Side,peer:PlannedPeer|null)=>{
  if(!peer)return;
  const original=unique(allLocal,peer.tripId,peer.line,now);
  if(original&&vehicleId(original)!=='—'){
   known.current.set(side+'|'+peer.tripId,vehicleId(original));
   if(known.current.size>60)known.current.delete(known.current.keys().next().value!);
  }
 };
 remember('ahead',ahead);remember('behind',behind);
 useEffect(()=>{
  if(!key||!candidatesKey){setRemote({key:'',values:[],updatedAt:0,loading:false});return;}
  let alive=true;
  const jobs=[...routes.ahead,...routes.behind];
  const distinct=[...new Map(jobs.map(j=>[j.tripId,j])).values()];
  // Prefer existing line snapshot when it is fresh. Fetch only missing
  // exact trips, including a successor that crossed a route boundary.
  const missing=distinct.filter(p=>!unique(features,p.tripId,p.line,Date.now()));
  setRemote(old=>({...old,key,loading:!!missing.length}));
  if(!missing.length){
   setRemote(old=>({...old,key,loading:false,updatedAt:Date.now()}));
   return;
  }
  void Promise.all(missing.map(async p=>{
   try{
    const response=await golemioJson<unknown>(tripPositionUrl(p.tripId),token,60000,'low');
    return exactTripPosition(response,{tripId:p.tripId,line:p.line,
     order:'',scheduledGap:0,departureSeconds:p.startSeconds,referenceStopId:''});
   }catch{return null;}
  })).then(values=>{
   if(!alive)return;
   setRemote({key,values:values.filter((v):v is Feature=>v!==null),
    updatedAt:Date.now(),loading:false});
  });
  return()=>{alive=false;};
 // One immediate fetch on selection and then at most once per minute.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,candidatesKey,minute,token]);
 const current=remote.key===key?[...features,...remote.values]:features;
 const find=(side:Side,peer:PlannedPeer|null)=>{
  if(!peer)return {feature:null,tripId:'',source:'none' as const};
  const available=routes[side];
  const anchor=known.current.get(side+'|'+peer.tripId);
  for(const candidate of [...available].reverse()){
   const exact=unique(current,candidate.tripId,candidate.line,now);
   if(!exact||vehicleId(exact)==='—')continue;
   if(candidate.tripId!==peer.tripId&&(!anchor||vehicleId(exact)!==anchor))continue;
   const own=unique(features,candidate.tripId,candidate.line,now);
   return {feature:exact,tripId:candidate.tripId,
    source:own?'existing' as const:'direct' as const};
  }
  return {feature:null,tripId:'',source:'unavailable' as const};
 };
 const first=find('ahead',ahead),second=find('behind',behind);
 return {
  features:[...new Set([first.feature,second.feature].filter((v):v is Feature=>v!==null))],
  status:{ahead:first.source,behind:second.source},
  tripIds:{ahead:first.tripId,behind:second.tripId},
  updatedAt:remote.updatedAt,loading:remote.loading
 };
}
