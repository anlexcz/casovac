import {normalize,orderOf,routeOf,stateOfFeature,vehicleId,originRouteOf} from './featureUtils.ts';
import type {Feature} from './featureUtils.ts';
import {selectTrip,tripStart} from './tripSelection.ts';

export type ChooserQuery=
 |{kind:'route';line:string}
 |{kind:'order';line:string;order:string}
 |{kind:'vehicle';vehicle:string}
 |{kind:'invalid'};

/** "#" explicitly separates registration numbers from route numbers. */
export function parseChooserQuery(raw:string):ChooserQuery{
 const value=raw.trim();
 const vehicle=/^#\s*(\d{1,7})$/.exec(value);
 if(vehicle)return {kind:'vehicle',vehicle:normalize(vehicle[1])};
 const order=/^(\d{1,3})\s*\/\s*(\d{1,4})$/.exec(value);
 if(order)return {kind:'order',line:normalize(order[1]),order:normalize(order[2])};
 const route=/^(\d{1,3})(?:\s*\/\s*)?$/.exec(value);
 if(route)return {kind:'route',line:normalize(route[1])};
 return {kind:'invalid'};
}

const routeOrderOf=(feature:Feature):string=>{
 const order=orderOf(feature);
 return order===undefined||order===null?'':normalize(String(order));
};
const currentKey=(feature:Feature):string=>{
 const line=routeOf(feature);
 const order=routeOrderOf(feature);
 return /^\d{1,3}$/.test(line)&&/^\d{1,4}$/.test(order)?normalize(line)+'/'+order:'';
};
const stableKey=(feature:Feature):string=>{
 const key=currentKey(feature);
 if(!key)return '';
 const origin=originRouteOf(feature);
 return origin?origin+'/'+routeOrderOf(feature):key;
};
export const queryMatches=(feature:Feature,query:ChooserQuery):boolean=>{
 const line=routeOf(feature),order=routeOrderOf(feature);
 if(!currentKey(feature))return false;
 if(query.kind==='invalid')return false;
 if(query.kind==='route')return normalize(line)===query.line;
 if(query.kind==='vehicle')return normalize(vehicleId(feature))===query.vehicle;
 // Prefix input is intentional: 2/7 covers 2/7 and 2/70–2/79.
 return order.startsWith(query.order)&&
  (normalize(line)===query.line||originRouteOf(feature)===query.line);
};
const ranking=(f:Feature,now:number):number=>{
 const state=stateOfFeature(f);
 const start=tripStart(f);
 const delta=start===null?Infinity:Math.abs(start-now);
 if(state==='on_track'||state==='at_stop')return 0;
 if(state.startsWith('before_track'))return start!==null&&start<now-300000?3:1;
 if(state.startsWith('after_track'))return 2;
 return delta<3600000?3:4;
};
/** One row represents one current order, or one stable operating order in
 * cross-route queries. Ended/prepared GTFS records of that order do not
 * produce duplicate rows. The vehicle remains unselectable if Golemio
 * reports an unresolved clash between cars.
 */
export type ChooserMatch={line:string;order:string;originRoute:string;car:string;
 feature:Feature;ambiguous:boolean;key:string};
export function resolveChooserMatches(features:Feature[],query:ChooserQuery,now:number):ChooserMatch[]{
 if(query.kind==='invalid')return [];
 const grouped=new Map<string,Feature[]>();
 for(const feature of features){
  if(!queryMatches(feature,query))continue;
  const key=query.kind==='route'?currentKey(feature):stableKey(feature);
  if(!key)continue;
  const group=grouped.get(key);
  if(group)group.push(feature);else grouped.set(key,[feature]);
 }
 const rows:ChooserMatch[]=[];
 for(const [key,group] of grouped){
  // Resolve each line independently before comparing different lines of
  // the same stable operating order.
  const byRoute=new Map<string,Feature[]>();
  for(const f of group){
   const line=normalize(routeOf(f));
   const list=byRoute.get(line);
   if(list)list.push(f);else byRoute.set(line,[f]);
  }
  const candidates:Feature[]=[];
  let ambiguous=false;
  for(const [line,items] of byRoute){
   const selected=selectTrip(items,line,routeOrderOf(items[0]),now);
   if(selected.ambiguous){ambiguous=true;continue;}
   if(selected.feature)candidates.push(selected.feature as Feature);
  }
  if(!candidates.length)continue;
  candidates.sort((a,b)=>ranking(a,now)-ranking(b,now)||
   Math.abs((tripStart(a)??now)-now)-Math.abs((tripStart(b)??now)-now));
  const top=candidates[0],tie=candidates[1];
  // Two simultaneously active vehicles under one stable identity are not
  // safe to resolve from route labels alone.
  if(tie&&ranking(top,now)===0&&ranking(tie,now)===0&&
   vehicleId(top)!==vehicleId(tie))ambiguous=true;
  const line=normalize(routeOf(top)),order=routeOrderOf(top);
  rows.push({line,order,originRoute:originRouteOf(top),car:vehicleId(top),
   feature:top,ambiguous,key});
 }
 return rows.sort((a,b)=>Number(a.line)-Number(b.line)||
  Number(a.order)-Number(b.order)||a.car.localeCompare(b.car));
}
