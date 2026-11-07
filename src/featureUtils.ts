// Shared accessors for Golemio payloads. Keep missing and empty values distinct.
export type Obj=Record<string,unknown>;
export type Feature={properties?:Obj;geometry?:{coordinates?:unknown}};
export const path=(obj:unknown,p:string):unknown=>
 p.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Obj)[k]:undefined,obj);
export const text=(value:unknown):string=>value===undefined||value===null?'—':String(value);
export const selectedTripId=(f:Feature)=>text(path(f,'properties.trip.gtfs.trip_id')??path(f,'properties.trip.trip_id'));
export const vehicleId=(f:Feature)=>text(path(f,'properties.trip.vehicle_registration_number')??path(f,'properties.trip.vehicle.id')??path(f,'properties.trip.vehicle_id'));
export const orderOf=(f:Feature)=>path(f,'properties.trip.sequence_id')??path(f,'properties.trip.cis.order')??path(f,'properties.trip.order')??path(f,'properties.trip.gtfs.run_number');
export const normalize=(v:unknown)=>String(v??'').replace(/^0+/,'')||'0';
// Common field accessors for live line, order and vehicle projections.
export const routeOf=(f:Feature):string=>String(path(f,'properties.trip.gtfs.route_short_name')??path(f,'properties.trip.route_short_name')??'');
export const stateOfFeature=(f:Feature):string=>String(path(f,'properties.last_position.state_position')??'');
export const rawTripOf=(f:Feature):unknown=>path(f,'properties.trip')??null;

/** Golemio's origin_route_name is the stable operating route within a duty.
 * An absent value stays absent; it must not be inferred from current route.
 */
export const originRouteOf=(f:Feature):string=>{
 const value=path(f,'properties.trip.origin_route_name');
 const raw=String(value??'').trim();
 return /^[0-9]{1,3}$/.test(raw)?normalize(raw):'';
};
