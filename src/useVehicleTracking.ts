import {useEffect,useRef,useState} from 'react';
import type {Dispatch,MutableRefObject,SetStateAction} from 'react';
import {golemioJson} from './golemioClient';
import {filterCoreFeatures} from './coreDutySelection.ts';
import type {TrackedService} from './trackedService.ts';
import {selectTrip,stateOf} from './tripSelection';
import {readLastSeen,saveLastSeen,extractRecordedVehicle} from './lastSeen';
import type {LastSeen} from './lastSeen';
import {observationTimestamp} from './remoteTracking';
import {path,normalize,orderOf,vehicleId,selectedTripId} from './featureUtils';
import type {Feature,Obj} from './featureUtils';
import type {GpsFix} from './position';
import type {useRecorder} from './recorder';

const API='https://api.golemio.cz/v2/vehiclepositions';
export type HandoffFallback={target:string;vehicle:string;feature:Feature;until:number};
type Props={
 active:[string,string]|null;
 trackedService:TrackedService|null;
 token:string;
 recorder:ReturnType<typeof useRecorder>;
 gps:GpsFix|null;
 setLastSeen:Dispatch<SetStateAction<LastSeen|null>>;
 setError:Dispatch<SetStateAction<string>>;
 handoffFallbackRef:MutableRefObject<HandoffFallback|null>;
};
export function useVehicleTracking({active,trackedService,token,recorder,gps,setLastSeen,setError,handoffFallbackRef}:Props){
 const [features,setFeatures]=useState<Feature[]>([]);
 const [lastFetch,setLastFetch]=useState<number|null>(null);
 const [queryMode,setQueryMode]=useState('active');
 const [relatedVehicle,setRelatedVehicle]=useState<{vehicle:string;route:string;order:string;state:string;time:number}|null>(null);
 const [terminalCandidates,setTerminalCandidates]=useState<unknown[]>([]);
 const [loading,setLoading]=useState(false);
 const previousScanRef=useRef(0);
 const requestRef=useRef(0);
 const gpsRef=useRef<GpsFix|null>(null);
 gpsRef.current=gps;
 const recordApiRef=useRef(recorder.api);recordApiRef.current=recorder.api;
 const recordErrorRef=useRef(recorder.apiError);recordErrorRef.current=recorder.apiError;
 useEffect(()=>{
  if(!active||!token.trim())return;
  const controller=new AbortController();let alive=true;let busy=false;
  const generation=++requestRef.current;
  async function refresh(){
   if(busy||!alive)return;busy=true;setLoading(true);
   const requestStartedAt=Date.now();
   try{
    const url=new URL(API);url.searchParams.set('routeShortName',active![0]);url.searchParams.set('limit','1000');
    url.searchParams.set('includeNotTracking','true');
    const data:unknown=await golemioJson<unknown>(url.toString(),token.trim(),12000);
    if(!alive||controller.signal.aborted)return;
    if(!data||typeof data!=='object'||!Array.isArray((data as Obj).features))throw Error('Neplatná odpověď živých poloh');
    if(alive&&generation===requestRef.current){
     const standard=(data as {features:Feature[]}).features;
     let fetched=filterCoreFeatures(standard,trackedService);
     // Keep the prepared successor visible while Golemio still reports the old line.
     // Never treat this cached object as a fresh observation.
     const fallback=handoffFallbackRef.current;
     if(!trackedService?.verified&&fallback&&fallback.target===active!.join('/')&&Date.now()<fallback.until){
      const liveSameOrder=standard.some(f=>normalize(orderOf(f))===normalize(active![1])&&
       String(path(f,'properties.trip.gtfs.route_short_name')??'')===active![0]&&
       (stateOf(f)==='at_stop'||stateOf(f)==='on_track'));
      if(!liveSameOrder)fetched=[...standard,fallback.feature];
      else handoffFallbackRef.current=null;
     }else if(fallback&&fallback.target===active!.join('/'))handoffFallbackRef.current=null;
     let selectedResult=selectTrip(fetched,active![0],active![1],Date.now(),
      readLastSeen(active![0],active![1])?.vehicle);
     let matching=selectedResult.matches;
     let queryMode='includeNotTracking';
     // If we have previously identified the physical car but the line/order
     // disappears during terminal layover, look for that exact car across routes.
     // Never mistake an unrelated car with the same order for a match.
     const known=readLastSeen(active![0],active![1])??
      extractRecordedVehicle(recorder.session,active![0],active![1]);
     let related:{vehicle:string;route:string;order:string;state:string;time:number}|null=null;
     if(!trackedService?.verified&&!matching.length&&known?.vehicle&&Date.now()-previousScanRef.current>=60000){
      previousScanRef.current=Date.now();
      try{
       const globalUrl=new URL(API);
       globalUrl.searchParams.set('includeNotTracking','true');
       globalUrl.searchParams.set('limit','3000');
       const body:unknown=await golemioJson<unknown>(globalUrl.toString(),token.trim(),30000);
       if(!controller.signal.aborted){
        const all=body&&typeof body==='object'&&Array.isArray((body as Obj).features)?
         (body as {features:Feature[]}).features:[];
        const sameCar=all.filter(item=>vehicleId(item)===known.vehicle);
        if(sameCar.length===1){
         const car=sameCar[0];
         const carRoute=String(path(car,'properties.trip.gtfs.route_short_name')??path(car,'properties.trip.route_short_name')??'');
         const carOrder=String(orderOf(car)??'');
         related={vehicle:known.vehicle,route:carRoute,order:carOrder,
          state:String(path(car,'properties.last_position.state_position')??''),
          time:Date.now()};
         if(carRoute===active![0]&&normalize(carOrder)===normalize(active![1])){
          fetched=[...fetched,car];matching=[car];queryMode='knownVehicle';
         }else queryMode='knownVehicleOnOtherTrip';
        }else queryMode='globalScanNoMatch';
       }
      }catch(e){if(controller.signal.aborted)throw e;queryMode='globalScanError';}
     }
     if(related)setRelatedVehicle(related);
     // The initial response and its non-tracking fallback are kept separate for
     // diagnostics: a vehicle may exist in one but not in the other.
     const terminalCandidatesFound=fetched.map(feature=>({
       order:orderOf(feature),vehicle:vehicleId(feature),tripId:selectedTripId(feature),
       state:path(feature,'properties.last_position.state_position'),
       nextStop:path(feature,'properties.last_position.next_stop'),
       start:path(feature,'properties.trip.start_timestamp')
     }));
     selectedResult=selectTrip(fetched,active![0],active![1],Date.now(),known?.vehicle);
     const proposed=selectedResult.feature;
     const selected=proposed;
     const candidates=!selected?fetched.map(feature=>({
       order:orderOf(feature),vehicle:vehicleId(feature),tripId:selectedTripId(feature),
       route:path(feature,'properties.trip.gtfs.route_short_name'),state:path(feature,'properties.last_position.state_position'),
       tracking:path(feature,'properties.last_position.tracking'),
       start:path(feature,'properties.trip.start_timestamp'),
       nextStop:path(feature,'properties.last_position.next_stop'),
       lastStop:path(feature,'properties.last_position.last_stop')
     })):null;
     recordApiRef.current({line:active![0],order:active![1],responseStatus:200,
      requestStartedAt,responseAt:Date.now(),matchingCount:matching.length,vehicle:selected,gps:gpsRef.current,
      source:selected?(selected===handoffFallbackRef.current?.feature?'handoff_pending':'unique_order'):'ambiguous_or_missing',candidateVehicles:candidates,queryMode});
     if(selected&&selected!==handoffFallbackRef.current?.feature){
      const loc=selected.geometry?.coordinates;
      const coords=Array.isArray(loc)&&loc.length>=2?loc:null;
      const p=path(selected,'properties.last_position') as Obj|undefined;
      const value:LastSeen={line:active![0],order:active![1],vehicle:vehicleId(selected),
       tripId:selectedTripId(selected),lastSeenAt:Date.now(),lastPositionAt:observationTimestamp(selected),
       lon:coords&&Number.isFinite(Number(coords[0]))?Number(coords[0]):null,
       lat:coords&&Number.isFinite(Number(coords[1]))?Number(coords[1]):null,
       lastStop:String(path(p,'last_stop.name')??''),nextStop:String(path(p,'next_stop.name')??''),
       state:String(path(p,'state_position')??''),
       route:String(path(selected,'properties.trip.gtfs.route_short_name')??active![0])};
      if(value.vehicle!=='—'){saveLastSeen(value);setLastSeen(value);}
      setRelatedVehicle(null);
     }
     setFeatures(fetched);setQueryMode(queryMode);setTerminalCandidates(terminalCandidatesFound);setLastFetch(Date.now());setError('');
    }
   }catch(e){if(alive&&!controller.signal.aborted){const message=e instanceof Error?e.message:String(e);setError(message);recordErrorRef.current(active![0],active![1],'fetch_error',message);}}
   finally{busy=false;if(alive)setLoading(false);}
  }
  void refresh();const timer=setInterval(()=>void refresh(),60000);
  return()=>{alive=false;clearInterval(timer);controller.abort();};
 },[active?.[0],active?.[1],token,trackedService?.verified,trackedService?.originRoute,trackedService?.sequenceId]);
 return {features,setFeatures,lastFetch,setLastFetch,queryMode,relatedVehicle,terminalCandidates,loading};
}
