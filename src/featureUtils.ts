// Shared, intentionally conservative accessors for Golemio's nested payloads.
import {tripIdOf,vehicleOf,orderOfTrip} from './tripSelection';
import type {TripFeature} from './tripSelection';

export type Feature=TripFeature;
export type Obj=Record<string,unknown>;
export const path=(obj:unknown,p:string):unknown=>
 p.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Obj)[k]:undefined,obj);
export const text=(value:unknown):string=>value===undefined||value===null?'—':String(value);
export const selectedTripId=(f:Feature)=>text(tripIdOf(f)||undefined);
export const vehicleId=(f:Feature)=>text(vehicleOf(f)||undefined);
export const orderOf=(f:Feature)=>orderOfTrip(f);
export const normalize=(v:unknown)=>String(v??'').replace(/^0+/,'')||'0';
