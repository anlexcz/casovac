import {useEffect,useRef,useState} from 'react';
import type {GpsFix} from './position';
const GPS_KEY='casovac:gps-preferred:v1';
const preference=()=>{try{return localStorage.getItem(GPS_KEY)==='1';}catch{return false;}};
const persist=(value:boolean)=>{try{if(value)localStorage.setItem(GPS_KEY,'1');else localStorage.removeItem(GPS_KEY);}catch{/* storage can be disabled */}};
export function useGpsTracking(recordGps:(fix:GpsFix)=>void){
 const [gpsWanted,setGpsWanted]=useState(preference);
 const [gps,setGps]=useState<GpsFix|null>(null);
 const [gpsError,setGpsError]=useState('');
 const recordGpsRef=useRef(recordGps);recordGpsRef.current=recordGps;
 useEffect(()=>{
  persist(gpsWanted);
  if(!gpsWanted){setGps(null);setGpsError('');return;}
  if(!navigator.geolocation){setGpsError('Geolokace není v prohlížeči dostupná.');return;}
  let alive=true;
  const watch=navigator.geolocation.watchPosition(
   p=>{if(alive){const fix={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,speed:p.coords.speed,timestamp:p.timestamp};setGps(fix);recordGpsRef.current(fix);setGpsError('');}},
   e=>{if(alive){setGps(null);setGpsError(e.message);}},
   {enableHighAccuracy:true,maximumAge:5000,timeout:20000}
  );
  return()=>{alive=false;navigator.geolocation.clearWatch(watch);};
 },[gpsWanted]);
 const toggleGPS=()=>setGpsWanted(value=>!value);
 return {gpsWanted,setGpsWanted,gps,gpsError,toggleGPS};
}
