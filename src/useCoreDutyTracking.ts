import {useEffect,useState} from 'react';
import type {TrackedService} from './trackedService.ts';
import {serviceKey} from './trackedService.ts';
import {decideCoreDuty} from './coreDutySelection.ts';
import type {CoreDecision} from './coreDutySelection.ts';
import {golemioJson} from './golemioClient.ts';
import type {Feature,Obj} from './featureUtils.ts';

const API='https://api.golemio.cz/v2/vehiclepositions';
const EMPTY:CoreDecision={candidate:null,reason:'unverified',matchedTrips:0,activeVehicles:0};
type Snapshot={key:string;decision:CoreDecision;checkedAt:number;error:string};
export function useCoreDutyTracking(service:TrackedService|null,token:string){
 const key=service?serviceKey(service)??'':'';
 const [snapshot,setSnapshot]=useState<Snapshot>({key:'',decision:EMPTY,checkedAt:0,error:''});
 useEffect(()=>{
  if(!key||!service?.verified||!token.trim())return;
  let alive=true,working=false;
  const refresh=async()=>{
   if(!alive||working||document.hidden)return;
   working=true;
   try{
    const url=new URL(API);
    url.searchParams.set('includeNotTracking','true');
    url.searchParams.set('limit','3000');
    // One shared fleet-wide snapshot every minute, low priority. The
    // central coordinator de-duplicates the chooser's identical request.
    const response:unknown=await golemioJson<unknown>(url.toString(),token.trim(),30000,'low');
    if(!response||typeof response!=='object'||!Array.isArray((response as Obj).features))
     throw Error('Neplatná odpověď živých poloh');
    const checkedAt=Date.now();
    const decision=decideCoreDuty((response as {features:Feature[]}).features,service,checkedAt);
    if(alive)setSnapshot({key,decision,checkedAt,error:''});
   }catch(e){if(alive)setSnapshot(old=>({key,decision:old.key===key?old.decision:EMPTY,
     checkedAt:old.key===key?old.checkedAt:0,error:e instanceof Error?e.message:String(e)}));}
   finally{working=false;}
  };
  void refresh();
  const interval=window.setInterval(()=>void refresh(),60000);
  const onVisible=()=>{if(!document.hidden)void refresh();};
  document.addEventListener('visibilitychange',onVisible);
  return()=>{alive=false;window.clearInterval(interval);document.removeEventListener('visibilitychange',onVisible);};
 // service's mutable current route/vehicle must NOT restart the global fetch.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,token]);
 return snapshot.key===key?snapshot:{key,decision:EMPTY,checkedAt:0,error:''};
}
