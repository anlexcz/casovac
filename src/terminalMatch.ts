import type {Stop} from './tripData';

// Terminal platforms can have different GTFS stop IDs after a turnback.
// Only accept that variation when both stop names AND coordinates agree.
const normalizedName=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .replace(/\s*\([^)]*\)/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
const distanceMeters=(a:Stop,b:Stop):number=>{
 if(a.lat===null||a.lon===null||b.lat===null||b.lon===null)return Infinity;
 const radians=Math.PI/180;
 const dx=(b.lon-a.lon)*radians*Math.cos(((a.lat+b.lat)/2)*radians);
 const dy=(b.lat-a.lat)*radians;
 return Math.hypot(dx,dy)*6371000;
};
export function sameTransitionStop(previous:Stop,next:Stop):boolean{
 if(previous.id&&next.id&&previous.id.trim().toUpperCase()===next.id.trim().toUpperCase())return true;
 const name1=normalizedName(previous.name),name2=normalizedName(next.name);
 return !!name1&&name1===name2&&distanceMeters(previous,next)<=120;
}
