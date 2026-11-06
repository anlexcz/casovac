import {useEffect,useMemo,useState} from 'react';
import {golemioJson} from './golemioClient';
import {findVerifiedBlockPair} from './blockPair';
import type {BlockPair,OnlineTripDetail} from './blockPair';
import type {ChainSnapshot,ChainTrip} from './chainDiagnostics';

type Input={tripId:string;line:string;token:string;date:string;snapshot:ChainSnapshot|null;enabled:boolean};
type State={key:string;pair:BlockPair|null;loading:boolean;reason:string};
const detailUrl=(id:string,date:string)=>{
 const url=new URL('https://api.golemio.cz/v2/gtfs/trips/'+encodeURIComponent(id));
 url.searchParams.set('date',date);
 url.searchParams.set('includeStopTimes','true');
 url.searchParams.set('includeStops','true');
 url.searchParams.set('includeRoute','true');
 return url.toString();
};
export function useOnlineBlockPair({tripId,line,token,date,snapshot,enabled}:Input){
 const candidates=useMemo(()=>{
  if(!snapshot||snapshot.error||snapshot.target.split('/')[0]!==line)return [];
  const seen=new Set<string>();
  return snapshot.related.filter(t=>{
   if(!t.tripId||t.tripId===tripId||seen.has(t.tripId))return false;
   seen.add(t.tripId);
   return true;
  }).sort((a,b)=>Number(b.vehicle===snapshot.vehicle)-Number(a.vehicle===snapshot.vehicle))
   .slice(0,16);
 },[snapshot?.target,snapshot?.vehicle,snapshot?.error,
   snapshot?.related.map(t=>t.tripId+':'+t.vehicle).join('|'),tripId,line]);
 const identity=enabled&&tripId&&token&&snapshot&&snapshot.target.split('/')[0]===line?
  tripId+'|'+date+'|'+candidates.map(t=>t.tripId).join('|'):'';
 const [state,setState]=useState<State>({key:'',pair:null,loading:false,reason:''});
 useEffect(()=>{
  if(!identity){setState({key:'',pair:null,loading:false,reason:''});return;}
  let live=true;
  setState({key:identity,pair:null,loading:true,reason:'Ověřuji block_id obou tripů.'});
  const get=(id:string)=>golemioJson<OnlineTripDetail>(detailUrl(id,date),token,10*60000,'low');
  void (async()=>{
   try{
    const current=await get(tripId);
    if(!live)return;
    if(!current?.block_id){
     setState({key:identity,pair:null,loading:false,reason:'Aktuální trip nemá block_id.'});return;
    }
    let matches:Array<{trip:ChainTrip;detail:OnlineTripDetail}>=[];
    // The live vehicle snapshot narrows this to a handful of candidate trip IDs.
    // Verify EVERY eligible candidate, never treat same car/order as proof.
    for(const candidate of candidates){
     if(!live)return;
     try{
      const detail=await get(candidate.tripId);
      if(detail?.block_id===current.block_id)matches.push({trip:candidate,detail});
     }catch{/* one missing candidate must not hide other matches */}
    }
    if(!live)return;
    const pair=findVerifiedBlockPair({tripId,line,start:null,detail:current},matches);
    setState({key:identity,pair,loading:false,reason:pair?pair.reason:
     'V online datech zatím nebyl ověřen druhý trip stejného bloku.'});
   }catch(e){
    if(live)setState({key:identity,pair:null,loading:false,reason:e instanceof Error?e.message:String(e)});
   }
  })();
  return()=>{live=false;};
 },[identity,tripId,line,token,date]);
 return state.key===identity?state:{key:identity,pair:null,loading:!!identity,reason:'Čekám na ověření GTFS.'};
}
