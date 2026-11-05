import {useEffect,useRef,useState} from 'react';
import type {Stop} from './tripData';
export type GpsFix={lat:number;lon:number;accuracy:number;speed:number|null;timestamp:number};
export function distanceMeters(lat:number,lon:number,lat2:number,lon2:number):number{
 const rad=Math.PI/180;const x=(lon2-lon)*rad*Math.cos((lat+lat2)/2*rad);const y=(lat2-lat)*rad;
 return Math.round(Math.hypot(x,y)*6371000);
}
export function usePosition(stops:Stop[],tripId:string,nextStopId:string,gps:GpsFix|null,vehicle:[number,number]|null,vehicleAge:number|null,now:number){
 const nextIndex=stops.findIndex(stop=>stop.id!==''&&stop.id===nextStopId);
 const [confirmed,setConfirmed]=useState<number|null>(null);
 const candidate=useRef<{index:number;first:number;count:number}|null>(null);
 const seen=useRef<number>(0);
 const lastContext=useRef('');
 const context=tripId+'|'+nextIndex;
 if(lastContext.current!==context){
  lastContext.current=context;
  candidate.current=null;seen.current=0;
 }
 const fresh=!!gps&&gps.accuracy<=35&&now-gps.timestamp<=15000&&now>=gps.timestamp-10000;
 const vehicleDistance=gps&&vehicle?distanceMeters(gps.lat,gps.lon,vehicle[1],vehicle[0]):null;
 const paired=fresh&&vehicleDistance!==null&&vehicleDistance<=180&&vehicleAge!==null&&vehicleAge<=45;
 const nearest=fresh?stops.map((stop,index)=>({
    index,meters:stop.lat===null||stop.lon===null?Infinity:distanceMeters(gps!.lat,gps!.lon,stop.lat,stop.lon)
 })).sort((a,b)=>a.meters-b.meters)[0]:undefined;
 const near=paired&&nearest&&nearest.meters<=Math.max(35,Math.min(75,2*(gps?.accuracy??0)))&&
 (nearest.index===nextIndex||nearest.index===nextIndex-1)?nearest:null;
 useEffect(()=>{
  setConfirmed(null);
 },[context]);
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
 },[gps,near?.index,near?.meters,context]);
 const validConfirmed=confirmed!==null&&(confirmed===nextIndex||confirmed===nextIndex-1)&&paired;
 const status=!gps?'GPS vypnutá':!fresh?'GPS nepřesná nebo zastaralá':!paired?'GPS a vozidlo nejsou spárované':validConfirmed?'Poloha potvrzena GPS':near?'Ověřuji polohu GPS':'GPS mimo očekávanou zastávku';
 return {nextIndex,confirmedIndex:validConfirmed?confirmed:null,vehicleDistance,gpsFresh:fresh,nearest,status};
}
