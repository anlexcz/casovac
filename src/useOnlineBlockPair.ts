import {useEffect,useMemo,useRef,useState} from 'react';
import {golemioJson} from './golemioClient';
import {findStaticBlockLinks} from './staticBlockPair.ts';
import {safeStaticServiceDate} from './staticTripAdapter.ts';
import {findVerifiedBlockPair} from './blockPair';
import type {BlockPair,OnlineTripDetail} from './blockPair';
import type {ChainSnapshot,ChainTrip} from './chainDiagnostics';
import {parseStops} from './tripData';

type Input={tripId:string;line:string;token:string;date:string;snapshot:ChainSnapshot|null;enabled:boolean};
type State={key:string;pair:BlockPair|null;previousPair:BlockPair|null;loading:boolean;reason:string};
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
 const identity=enabled&&tripId&&token&&line?
  tripId+'|'+date+'|'+candidates.map(t=>t.tripId).join('|'):'';
 const [state,setState]=useState<State>({key:'',pair:null,previousPair:null,loading:false,reason:''});
 const saved=useRef<{tripId:string;date:string;line:string;order:string;vehicle:string;pair:BlockPair}|null>(null);
 const retained=():BlockPair|null=>{
  const old=saved.current;
  if(!old||old.date!==date)return null;
  if(old.tripId===tripId)return old.pair;
  if(old.pair.partner.tripId===tripId)return {
   ...old.pair,role:old.pair.role==='first'?'second':'first',
   partner:{line:old.line,order:old.order,tripId:old.tripId,
    vehicle:old.vehicle,state:'after_track',start:null,lastStop:null,
    nextStop:null,rawTrip:null,source:'ověřený předchozí trip'}
  };
  return null;
 };
 useEffect(()=>{
  if(!identity){setState({key:'',pair:null,previousPair:null,loading:false,reason:''});return;}
  let live=true;
  setState({key:identity,pair:retained(),previousPair:null,
   loading:true,reason:'Ověřuji block_id navazujících tripů.'});
  const get=(id:string)=>golemioJson<OnlineTripDetail>(detailUrl(id,date),token,10*60000,'low');
  void (async()=>{
   try{
    // Static-first only outside the ambiguous post-midnight service window.
    // Missing/incomplete/ambiguous static blocks retain the old Golemio path.
    if(safeStaticServiceDate(date,true,new Date())){
     try{
      const links=await findStaticBlockLinks(tripId,line,date);
      if(!live)return;
      const staticPair=links.next??links.previous;
      if(staticPair){
       saved.current={tripId,date,line,order:snapshot?.target.split('/')[1]??'',
        vehicle:snapshot?.vehicle??'',pair:staticPair};
       setState({key:identity,pair:staticPair,previousPair:links.previous,
        loading:false,reason:staticPair.reason});
       return;
      }
     }catch{/* Static data unavailable or inconsistent; use online discovery. */}
    }
    const current=await get(tripId);
    if(!live)return;
    if(!current?.block_id){
     setState({key:identity,pair:null,previousPair:null,loading:false,reason:'Aktuální trip nemá block_id.'});return;
    }
    let matches:Array<{trip:ChainTrip;detail:OnlineTripDetail}>=[];
    // The live vehicle snapshot narrows this to a handful of candidate trip IDs.
    // Verify EVERY eligible candidate, never treat same car/order as proof.
    for(const candidate of candidates){
     if(!live)return;
     try{
      const detail=await get(candidate.tripId);
      if(detail?.block_id===current.block_id){
       matches.push({trip:candidate,detail});
       // A verified two-trip block needs no further calls for unrelated orders.
       if(findVerifiedBlockPair({tripId,line,start:null,detail:current},matches))break;
      }
     }catch{/* one missing candidate must not hide other matches */}
    }
    // The first trip ID is itself the block_id in observed PID chained trips.
    // When launched during the second trip, retrieve the first directly,
    // even when after_track has already disappeared from vehiclepositions.
    if(current.block_id!==tripId&&!matches.some(m=>m.trip.tripId===current.block_id)){
     try{
      const earlier=await get(current.block_id);
      const route=earlier.route?.route_short_name??'';
      if(earlier.trip_id===current.block_id&&earlier.block_id===current.block_id&&route&&route!==line){
       matches.push({detail:earlier,trip:{
        line:route,order:'',tripId:earlier.trip_id,vehicle:'',state:'after_track',
        start:null,lastStop:null,nextStop:null,rawTrip:null,source:'online block_id'
       }});
      }
     }catch{/* not every block_id is a directly addressable trip_id */}
    }
    // If the companion is not yet present in vehiclepositions, ask the
    // online GTFS list for trips serving the common terminal on this date.
    // This is a single on-demand lookup, not a downloaded GTFS archive.
    if(!findVerifiedBlockPair({tripId,line,start:null,detail:current},matches)){
     const stops=parseStops(current);
     const terminalId=stops[stops.length-1]?.id;
     if(terminalId){
      try{
       const url=new URL('https://api.golemio.cz/v2/gtfs/trips');
       url.searchParams.set('date',date);
       url.searchParams.set('stopId',terminalId);
       url.searchParams.set('limit','2000');
       const found=await golemioJson<unknown>(url.toString(),token,15*60000,'low');
       if(Array.isArray(found)){
        const possibilities=(found as OnlineTripDetail[]).filter(item=>
         item.trip_id!==tripId&&item.block_id===current.block_id&&
         !!item.trip_id&&String((item as OnlineTripDetail&{route_id?:string}).route_id??'')!=='L'+line);
        // Only inspect the small set of trips sharing the exact block ID.
        for(const possible of possibilities.slice(0,8)){
         try{
          const detail=await get(possible.trip_id!);
          const companionLine=detail.route?.route_short_name??'';
          if(companionLine&&companionLine!==line){
           matches.push({detail,trip:{line:companionLine,order:'',tripId:possible.trip_id!,
            vehicle:'',state:'before_track',start:null,lastStop:null,nextStop:null,
            rawTrip:null,source:'online GTFS terminal'}});
          }
         }catch{/* keep partial data */}
        }
       }
      }catch{/* endpoint may be unavailable or rate limited */}
     }
    }
    if(!live)return;
    const pair=findVerifiedBlockPair({tripId,line,start:null,detail:current},matches);
    if(pair)saved.current={tripId,date,line,order:snapshot?.target.split('/')[1]??'',
     vehicle:snapshot?.vehicle??'',pair};
    setState({key:identity,pair:pair??retained(),previousPair:pair?.role==='second'?pair:null,loading:false,reason:pair?pair.reason:
     'V online datech zatím nebyl ověřen druhý trip stejného bloku.'});
   }catch(e){
    if(live)setState({key:identity,pair:retained(),previousPair:null,loading:false,reason:e instanceof Error?e.message:String(e)});
   }
  })();
  return()=>{live=false;};
 },[identity,tripId,line,token,date]);
 return state.key===identity?state:{key:identity,
  pair:saved.current?.tripId===tripId&&saved.current?.date===date?saved.current.pair:null,
  previousPair:null,loading:!!identity,reason:'Čekám na ověření GTFS.'};
}
