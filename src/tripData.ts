import {useEffect,useMemo,useState} from 'react';
import {auditedFetch} from './networkAudit';

export type Stop = {id:string;name:string;sequence:number;arrival:string;departure:string;lat:number|null;lon:number|null;platformCode?:string};
type RecordValue=Record<string,unknown>;
const get=(value:unknown,path:string):unknown=>path.split('.').reduce<unknown>((v,key)=>v&&typeof v==='object'?(v as RecordValue)[key]:undefined,value);
const first=(object:unknown,keys:string[])=>keys.map(key=>get(object,key)).find(value=>value!==undefined&&value!==null&&value!=='');
const txt=(value:unknown)=>value===undefined||value===null?'':String(value);
const num=(value:unknown):number|null=>value===undefined||value===null||value===''||!Number.isFinite(Number(value))?null:Number(value);

function findStopArray(input:unknown):unknown[]{
  const queue:unknown[]=[input];const seen=new Set<unknown>();
  for(let i=0;queue.length&&i<40;i++){
    const value=queue.shift();if(value===null||value===undefined||seen.has(value))continue;seen.add(value);
    if(Array.isArray(value)){
      if(value.length&&value.some(item=>typeof item==='object'&&item!==null&&first(item,['stop_id','stop_sequence','arrival_time','departure_time','properties.stop_id','properties.stop_sequence','stop.name','stop_name','properties.stop_name','properties.stop.stop_name','stop.stop_name'])!==undefined))return value;
      continue;
    }
    if(typeof value==='object')for(const key of ['stop_times','stopTimes','stoptimes','stops','features','data','result','items','trip','records'])if(key in (value as RecordValue))queue.push((value as RecordValue)[key]);
  }
  return [];
}
export function parseStops(data:unknown):Stop[]{
  const list=findStopArray(data);
  return list.map((item,i)=>{
    const stop=first(item,['stop','properties.stop','stop_info','stop_data'])??{};
    const coords=first(stop,['geometry.coordinates','coordinates'])??get(item,'geometry.coordinates');
    const point=Array.isArray(coords)?coords:[];
    return {
      id:txt(first(item,['stop_id','stopId','stop.id','properties.stop_id','properties.stop.id','properties.id','stop.properties.id','stop.properties.stop_id','stop.stopId','properties.stop.stopId','stop.stop_id','stop.stop.stop_id'])??first(stop,['id','stop_id','properties.stop_id'])),
      name:txt(first(item,['stop_name','stopName','stop.name','properties.stop_name','properties.stop.name'])??first(stop,['name','stop_name','properties.stop_name','properties.name']))||'Neznámá zastávka',
      sequence:num(first(item,['stop_sequence','stopSequence','sequence','properties.stop_sequence']))??i+1,
      arrival:txt(first(item,['arrival_time','arrivalTime','arrival.time','properties.arrival_time'])),
      departure:txt(first(item,['departure_time','departureTime','departure.time','properties.departure_time'])),
      lat:num(first(item,['stop_lat','lat','stop.lat','properties.stop_lat'])??point[1]),
      lon:num(first(item,['stop_lon','lon','stop.lon','properties.stop_lon'])??point[0]),
      platformCode:txt(first(item,['platform_code','platformCode','stop.platform_code','stop.platformCode','properties.platform_code'])??first(stop,['platform_code','platformCode','properties.platform_code']))
    };
  }).sort((a,b)=>a.sequence-b.sequence);
}
/** Fill missing IDs only from a second authoritative GTFS stop-times record.
 * We never infer boarding edges from the display name or geographic proximity.
 */
export function mergeVerifiedStopIds(primary:Stop[],alternate:Stop[]):Stop[]{
 if(!primary.length||!alternate.length)return primary;
 return primary.map(original=>{
  if(original.id)return original;
  const options=alternate.filter(candidate=>
   !!candidate.id&&candidate.sequence===original.sequence&&
   candidate.name===original.name&&
   (!original.arrival||!candidate.arrival||original.arrival===candidate.arrival)&&
   (!original.departure||!candidate.departure||original.departure===candidate.departure));
  if(options.length!==1)return original;
  return {...original,id:options[0].id,platformCode:original.platformCode||options[0].platformCode};
 });
}
export type TripData={tripId:string;stops:Stop[];headsign:string;route:string;raw:unknown;error:string;loading:boolean;source:string};
type TripContent=Omit<TripData,'tripId'>;
const EMPTY:TripContent={stops:[],headsign:'',route:'',raw:null,error:'',loading:false,source:''};
// Only public timetable content is cached, never access tokens or personal locations.
const tripCache=new Map<string,{data:TripContent;at:number}>();
const getCached=(id:string):TripContent|null=>{
 const item=tripCache.get(id);
 return item&&Date.now()-item.at<6*3600000?item.data:null;
};
const remember=(id:string,data:TripContent)=>{
 if(!data.stops.length)return;
 tripCache.set(id,{data,at:Date.now()});
 if(tripCache.size>60)tripCache.delete(tripCache.keys().next().value!);
};
export function useTripData(tripId:string,token:string):TripData{
 const [state,setState]=useState<{id:string;data:TripContent}>({id:'',data:EMPTY});
 useEffect(()=>{
  if(!tripId||tripId==='—'||!token){setState({id:tripId,data:EMPTY});return;}
  const cached=getCached(tripId);
  if(cached){setState({id:tripId,data:cached});return;}
  const abort=new AbortController();
  setState({id:tripId,data:{...EMPTY,loading:true}});
  (async()=>{
   try{
    const url=new URL('https://api.golemio.cz/v2/public/gtfs/trips/'+encodeURIComponent(tripId));
    url.searchParams.append('scopes[]','info');
    url.searchParams.append('scopes[]','stop_times');
    url.searchParams.append('scopes[]','shapes');
    const headers={'X-Access-Token':token};
    const response=await auditedFetch(url,{headers,cache:'no-store',signal:abort.signal},'tripData');
    if(!response.ok)throw new Error('Detail tripu: HTTP '+response.status);
    const data:unknown=await response.json();
    if(abort.signal.aborted)return;
    const obj=data as RecordValue;
    let stops=parseStops(data);
    let source='GTFS Lookup / trip';
    let fallbackError='';
    if(!stops.length||stops.some(stop=>!stop.id)){
     // A usable timetable without stop_id cannot drive departureboards.
     // The backup endpoint might expose the missing authoritative platform ID.
     try{
      const fallback=await auditedFetch('https://api.golemio.cz/v2/gtfs/stoptimes/'+encodeURIComponent(tripId),{headers,cache:'no-store',signal:abort.signal},'tripData-fallback');
      if(fallback.ok){
       const item:unknown=await fallback.json();
       const alternative=parseStops(item);
       if(!stops.length){stops=alternative;source='GTFS stop_times';}
       else {
        const completed=mergeVerifiedStopIds(stops,alternative);
        if(completed.some((stop,i)=>!!stop.id&&!stops[i].id))source+=' + ověřená ID z GTFS stop_times';
        stops=completed;
       }
      }else fallbackError='Záložní stop_times HTTP '+fallback.status;
     }catch(e){
      if(abort.signal.aborted)return;
      fallbackError='Záložní stop_times: '+(e instanceof Error?e.message:String(e));
     }
    }
    if(!abort.signal.aborted){
     const content:TripContent={
      stops,headsign:txt(obj.trip_headsign),route:txt(obj.route_short_name),raw:data,
      source,loading:false,error:stops.length?'':(fallbackError||'Jízdní řád neobsahuje rozpoznané zastávky')
     };
     remember(tripId,content);
     setState({id:tripId,data:content});
    }
   }catch(e){
    if(!abort.signal.aborted)setState({id:tripId,data:{
     ...EMPTY,error:e instanceof Error?e.message:String(e)
    }});
   }
  })();
  return()=>abort.abort();
 },[tripId,token]);
 const result=getCached(tripId)??(state.id===tripId?state.data:EMPTY);
 return useMemo(()=>({...result,tripId}),[result,tripId]);
}
export function formatStopTime(value:string):string{
  const match=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if(match)return match[1].padStart(2,'0')+':'+match[2];
  const date=new Date(value);
  return value&&!Number.isNaN(date.getTime())?date.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}):'—';
}
// GTFS permits times above 24:00. Pick the most plausible service day near now.
export function countdownSeconds(value:string,now:number):number|null{
  const match=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if(!match)return null;
  const hours=Number(match[1]),minutes=Number(match[2]),seconds=Number(match[3]??0);
  if(minutes>=60||seconds>=60)return null;
  const d=new Date(now);d.setHours(0,0,0,0);
  const candidate=[-1,0,1].map(day=>{
    const date=new Date(d.getTime());date.setDate(date.getDate()+day);date.setHours(hours,minutes,seconds,0);
    return Math.round((date.getTime()-now)/1000);
  }).sort((a,b)=>Math.abs(a)-Math.abs(b))[0];
  // Prevent misleading countdown when the selected schedule is far away.
  return Math.abs(candidate)<=21600?candidate:null;
}
export function formatCountdown(seconds:number|null):string{
  if(seconds===null)return '--:--';
  const abs=Math.abs(seconds),mins=Math.floor(abs/60),secs=abs%60;
  return (seconds<0?'-':'')+String(mins).padStart(2,'0')+':'+String(secs).padStart(2,'0');
}
