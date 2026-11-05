import {useEffect,useRef,useState} from 'react';
import type {Stop} from './tripData';
export type GpsFix={lat:number;lon:number;accuracy:number;speed:number|null;timestamp:number};
export function distanceMeters(lat:number,lon:number,lat2:number,lon2:number):number{
 const rad=Math.PI/180;const x=(lon2-lon)*rad*Math.cos((lat+lat2)/2*rad);const y=(lat2-lat)*rad;
 return Math.round(Math.hypot(x,y)*6371000);
}
export function normalizedStopId(value:string):string{return value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');}
function nearStop(stops:Stop[],lat:number,lon:number,now:number){
 const choices=stops.map((stop,index)=>({
  index,
  meters:stop.lat===null||stop.lon===null?Infinity:distanceMeters(lat,lon,stop.lat,stop.lon),
  schedule:stop.departure||stop.arrival
 })).filter(item=>Number.isFinite(item.meters));
 choices.sort((a,b)=>a.meters-b.meters);
 const closest=choices[0];
 if(!closest)return null;
 // A duplicate position is common at terminal loops. Prefer time proximity among similarly located platforms.
 const similar=choices.filter(item=>item.meters<=closest.meters+30);
 const d=new Date(now);
 const localMinutes=d.getHours()*60+d.getMinutes();
 const scheduleDistance=(time:string)=>{
  const parts=/^(\d{1,2}):(\d{2})/.exec(time);
  if(!parts)return Infinity;
  const m=Number(parts[1])*60+Number(parts[2]);
  return Math.min(Math.abs(m-localMinutes),Math.abs(m-localMinutes+1440),Math.abs(m-localMinutes-1440));
 };
 return (similar.length>1?similar.sort((a,b)=>scheduleDistance(a.schedule)-scheduleDistance(b.schedule)):choices)[0];
}
export function usePosition(stops:Stop[],tripId:string,nextStopId:string,gps:GpsFix|null,vehicle:[number,number]|null,vehicleAge:number|null,now:number){
 const cleanId=normalizedStopId(nextStopId);
 const nextIndex=stops.findIndex(stop=>cleanId!==''&&cleanId!=='NEZNAMA'&&normalizedStopId(stop.id)===cleanId);
 const [confirmed,setConfirmed]=useState<number|null>(null);
 const candidate=useRef<{index:number;first:number;count:number}|null>(null);
 const seen=useRef<number>(0);
 const context=tripId+'|'+nextIndex;
 const fresh=!!gps&&gps.accuracy<=35&&now-gps.timestamp<=15000&&now>=gps.timestamp-10000;
 const vehicleFresh=!!vehicle&&vehicleAge!==null&&vehicleAge<=45;
 const vehicleDistance=gps&&vehicle?distanceMeters(gps.lat,gps.lon,vehicle[1],vehicle[0]):null;
 const paired=fresh&&vehicleDistance!==null&&vehicleDistance<=250&&vehicleFresh;
 const vehicleNearest=vehicleFresh&&vehicle?nearStop(stops,vehicle[1],vehicle[0],now):null;
 const gpsNearest=fresh&&gps?nearStop(stops,gps.lat,gps.lon,now):null;
 // The platform ID must win when available. Otherwise derive a provisional index from the
 // vehicle GPS within a bounded radius; do not guess an arbitrary stop over long distances.
 const fallback=nextIndex<0&&vehicleNearest&&vehicleNearest.meters<=350?vehicleNearest:null;
 const inferredNextIndex=fallback?.index??null;
 const baseIndex=nextIndex>=0?nextIndex:inferredNextIndex;
 const near=paired&&gpsNearest&&baseIndex!==null&&gpsNearest.meters<=Math.max(35,Math.min(75,2*(gps?.accuracy??0)))&&
 (gpsNearest.index===baseIndex||gpsNearest.index===baseIndex-1)?gpsNearest:null;
 useEffect(()=>{candidate.current=null;seen.current=0;setConfirmed(null);},[context]);
 useEffect(()=>{
  if(!gps||gps.timestamp===seen.current)return;
  seen.current=gps.timestamp;
  if(!near){candidate.current=null;setConfirmed(null);return;}
  const c=candidate.current;
  if(!c||c.index!==near.index||gps.timestamp-c.first>20000){
   candidate.current={index:near.index,first:gps.timestamp,count:1};setConfirmed(null);return;
  }
  candidate.current={...c,count:c.count+1};
  if(c.count>=1&&gps.timestamp-c.first>=3000)setConfirmed(near.index);
 },[gps,near?.index,context]);
 const validConfirmed=confirmed!==null&&baseIndex!==null&&(confirmed===baseIndex||confirmed===baseIndex-1)&&paired;
 const status=!gps?'GPS vypnutá':!fresh?'GPS nepřesná nebo zastaralá':!paired?'GPS a vozidlo nejsou spárované':validConfirmed?'Poloha potvrzena GPS':near?'Ověřuji polohu GPS':'GPS mimo očekávanou zastávku';
 return {nextIndex,inferredNextIndex,baseIndex,confirmedIndex:validConfirmed?confirmed:null,vehicleDistance,vehicleNearest,gpsNearest,source:nextIndex>=0?'id':inferredNextIndex!==null?'vehicle':'unknown',gpsFresh:fresh,status};
}
