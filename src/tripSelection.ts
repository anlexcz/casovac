import {path,normalize} from './featureUtils.ts';
// A single vehicle may have an ended trip and the next planned trip in one
// includeNotTracking response. Resolve the vehicle first, then the trip.
export type TripFeature={properties?:Record<string,unknown>;geometry?:{coordinates?:unknown}};
const at=path;
export const tripIdOf=(f:TripFeature)=>String(at(f,'properties.trip.gtfs.trip_id')??at(f,'properties.trip.trip_id')??'');
export const vehicleOf=(f:TripFeature)=>String(at(f,'properties.trip.vehicle_registration_number')??at(f,'properties.trip.vehicle.id')??at(f,'properties.trip.vehicle_id')??'');
export const orderOfTrip=(f:TripFeature)=>at(f,'properties.trip.sequence_id')??at(f,'properties.trip.cis.order')??at(f,'properties.trip.order')??at(f,'properties.trip.gtfs.run_number');
export const stateOf=(f:TripFeature)=>String(at(f,'properties.last_position.state_position')??'unknown');
const routeOf=(f:TripFeature)=>String(at(f,'properties.trip.gtfs.route_short_name')??at(f,'properties.trip.route_short_name')??'');
const number=normalize;
const stamp=(value:unknown):number|null=>{
 if(typeof value==='number'&&Number.isFinite(value))return value<1e11?value*1000:value;
 if(typeof value==='string'){const time=Date.parse(value);return Number.isFinite(time)?time:null;}
 return null;
};
export const tripStart=(f:TripFeature):number|null=>stamp(
 at(f,'properties.trip.start_timestamp')??at(f,'properties.last_position.next_stop.departure_time'));
export const isBeforeTrip=(f:TripFeature)=>stateOf(f).startsWith('before_track');
export const isAfterTrip=(f:TripFeature)=>stateOf(f).startsWith('after_track');
export const isActiveTrip=(f:TripFeature)=>stateOf(f)==='at_stop'||stateOf(f)==='on_track';
export const terminalTrip=(f:TripFeature|null,now:number)=>!!f&&isBeforeTrip(f)&&
 (tripStart(f)===null||tripStart(f)!<=now+2*3600000&&tripStart(f)!>=now-30*60000);
export type Selection={feature:TripFeature|null;matches:TripFeature[];reason:string;vehicle:string|null;ambiguous:boolean};
export function selectTrip(features:TripFeature[],line:string,order:string,now:number,knownVehicle?:string|null):Selection{
 const matches=features.filter(f=>number(orderOfTrip(f))===number(order)&&(!routeOf(f)||routeOf(f)===line));
 if(!matches.length)return {feature:null,matches,reason:'Pořadí momentálně není v odpovědi Golemia.',vehicle:null,ambiguous:false};
 const vehicles=new Map<string,TripFeature[]>();
 for(const f of matches){const v=vehicleOf(f);if(!v||v==='—')continue;vehicles.set(v,[...(vehicles.get(v)??[]),f]);}
 if(vehicles.size===0)return {feature:null,matches,reason:'Pořadí nemá identifikovatelné vozidlo.',vehicle:null,ambiguous:true};
 let vehicle:string|null=null;
 // The selected operating order takes precedence over a remembered vehicle.
 // A replacement can appear while the old car still has an ended/prepared record.
 const activeVehicles=[...vehicles].filter(([,trips])=>trips.some(isActiveTrip));
 if(activeVehicles.length===1)vehicle=activeVehicles[0][0];
 else if(activeVehicles.length>1){
  // During a vehicle replacement the old and new car can briefly both
  // carry an active state. Resolve only if one has clearly fresher telemetry.
  const observation=(f:TripFeature)=>stamp(
   at(f,'properties.last_position.origin_timestamp')??
   at(f,'properties.last_position.timestamp')??
   at(f,'properties.last_position.last_updated')??
   at(f,'properties.last_position.recorded_at')??
   at(f,'properties.last_position.updated_at'))??0;
  const ranked=activeVehicles.map(([id,trips])=>({
   id,time:Math.max(...trips.filter(isActiveTrip).map(observation))
  })).sort((a,b)=>b.time-a.time);
  if(ranked[0].time>now-90000&&ranked[0].time-ranked[1].time>=30000)
   vehicle=ranked[0].id;
  else return {feature:null,matches,reason:'Dva vozy současně hlásí stejné pořadí bez jednoznačně novější polohy.',vehicle:null,ambiguous:true};
 }else if(vehicles.size===1)vehicle=[...vehicles.keys()][0];
 else {
  const prepared=[...vehicles].filter(([,trips])=>trips.some(f=>isBeforeTrip(f)&&
   (tripStart(f)===null||tripStart(f)!>=now-30*60000)));
  if(prepared.length===1)vehicle=prepared[0][0];
  else if(knownVehicle&&vehicles.has(knownVehicle))vehicle=knownVehicle;
 }
 if(!vehicle)return {feature:null,matches,reason:'Stejné pořadí je přiřazeno více vozům bez jednoznačného aktivního tripu.',vehicle:null,ambiguous:true};
 const owned=vehicles.get(vehicle)!;
 // Prefer an active trip, but never let its ended record hide the prepared trip.
 const active=owned.filter(isActiveTrip);
 const future=owned.filter(isBeforeTrip).sort((a,b)=>{
  const ta=tripStart(a),tb=tripStart(b);
  const pa=ta===null?Infinity:ta>=now-30*60000?Math.abs(ta-now):Infinity;
  const pb=tb===null?Infinity:tb>=now-30*60000?Math.abs(tb-now):Infinity;
  return pa-pb;
 });
 const selected=active.sort((a,b)=>(tripStart(b)??0)-(tripStart(a)??0))[0]??
  future.find(f=>tripStart(f)===null||tripStart(f)!>=now-30*60000)??
  owned.filter(isAfterTrip).sort((a,b)=>(tripStart(b)??0)-(tripStart(a)??0))[0]??null;
 return {feature:selected,matches,vehicle,ambiguous:false,reason:selected?
  isBeforeTrip(selected)?'Připravovaný trip stejného vozu.':isActiveTrip(selected)?'Aktivní trip stejného vozu.':'Poslední ukončený trip stejného vozu.':
  'Nebyl nalezen časově relevantní trip.'};
}
