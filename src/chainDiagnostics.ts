import {useEffect,useRef,useState} from 'react';
import {golemioJson} from './golemioClient';
import {path,normalize,vehicleId,orderOf,selectedTripId,routeOf,stateOfFeature,rawTripOf} from './featureUtils';
import type {Feature,Obj} from './featureUtils';

export type ChainTrip={
  line:string;order:string;tripId:string;vehicle:string;state:string;
  start:unknown;lastStop:unknown;nextStop:unknown;rawTrip:unknown;source:string;
};
export type ChainSnapshot={
  target:string;vehicle:string;time:number;relatedLine:string;
  primary:ChainTrip[];related:ChainTrip[];relatedTotal:number;
  error:string;loading:boolean;
};
const pairs:Record<string,string>={'5':'6','6':'5','9':'10','10':'9'};
const vehicle=(f:Feature)=>{const id=vehicleId(f);return id==='—'?'':id;};
const summarize=(f:Feature,source:string):ChainTrip=>({
 line:routeOf(f),
 order:String(orderOf(f)??''),
 tripId:selectedTripId(f)==='—'?'':selectedTripId(f),
 vehicle:vehicle(f),state:stateOfFeature(f),
 start:path(f,'properties.trip.start_timestamp')??null,
 lastStop:path(f,'properties.last_position.last_stop')??null,
 nextStop:path(f,'properties.last_position.next_stop')??null,
 rawTrip:rawTripOf(f),source
});
export function useChainDiagnostics(args:{
  active:[string,string]|null;knownVehicle:string;token:string;enabled:boolean;
  primaryFeatures:Feature[];record:(value:unknown)=>void;
}):ChainSnapshot|null {
 const [snapshot,setSnapshot]=useState<ChainSnapshot|null>(null);
 const line=args.active?.[0]??'';
 const order=args.active?.[1]??'';
 const paired=pairs[line]??'';
 const known=args.knownVehicle;
 const token=args.token;
 const record=args.record;
 const enabled=args.enabled;
 // Keep the newest primary-line observations, including prepared trips on that line.
 const primaryFeaturesRef=useRef(args.primaryFeatures);
 primaryFeaturesRef.current=args.primaryFeatures;
 useEffect(()=>{
  if(!enabled||!paired||!line||!order||!token){
   setSnapshot(null);
   return;
  }
  let alive=true;
  let busy=false;
  const run=async()=>{
   if(busy)return;
   busy=true;
   setSnapshot(old=>old&&old.target===line+'/'+order&&old.vehicle===known?
    {...old,loading:true}:{
     target:line+'/'+order,vehicle:known,time:0,relatedLine:paired,
     primary:[],related:[],relatedTotal:0,error:'',loading:true
    });
   try{
    const url=new URL('https://api.golemio.cz/v2/vehiclepositions');
    url.searchParams.set('routeShortName',paired);
    url.searchParams.set('includeNotTracking','true');
    url.searchParams.set('limit','1000');
    const response:unknown=await golemioJson<unknown>(url.toString(),token,30000);
    if(!response||typeof response!=='object'||!Array.isArray((response as Obj).features)){
     throw new Error('Neplatná odpověď Golemia pro návaznou linku.');
    }
    if(!alive)return;
    const all=(response as {features:Feature[]}).features;
    const primary=primaryFeaturesRef.current.filter(f=>normalize(vehicle(f))===normalize(known))
     .map(f=>summarize(f,'původní linka'));
    const related=all.filter(f=>normalize(orderOf(f))===normalize(order)||!!known&&normalize(vehicle(f))===normalize(known))
     .map(f=>summarize(f,'návazná linka'));
    const next:ChainSnapshot={
     target:line+'/'+order,vehicle:known,time:Date.now(),relatedLine:paired,
     primary,related,relatedTotal:all.length,error:'',loading:false
    };
    setSnapshot(next);
    record({...next,kind:'chain_probe',capturedAt:new Date(next.time).toISOString()});
   }catch(e){
    if(!alive)return;
    const message=e instanceof Error?e.message:String(e);
    setSnapshot(old=>old?{...old,time:Date.now(),error:message,loading:false}:null);
    record({kind:'chain_probe_error',line,order,vehicle:known,relatedLine:paired,error:message});
   }finally{busy=false;}
  };
  void run();
  const interval=setInterval(()=>void run(),40000);
  return()=>{alive=false;clearInterval(interval);};
 // Only restart if identity or recording mode changes, not every second.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,line,order,paired,known,token,record]);
 return snapshot;
}
