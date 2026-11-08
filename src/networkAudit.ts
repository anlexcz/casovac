/** Phase 0: opt-in local request diagnostics. No tokens, URLs, locations, or response bodies. */
export type NetworkEventKind='http'|'cache'|'coalesced'|'rejected';
export type NetworkEvent={
 at:string;source:string;endpoint:string;kind:NetworkEventKind;
 status:number|null;durationMs:number|null;ttlMs:number|null;
};
export type NetworkAuditReport={
 version:1;exportedAt:string;scenario:string;events:NetworkEvent[];
 summary:Array<{endpoint:string;source:string;http:number;cache:number;coalesced:number;rejected:number;errors:number;rateLimited:number;meanDurationMs:number|null}>;
};
const EVENTS='casovac:network-audit-events:v1';
const SCENARIO='casovac:network-audit-scenario:v1';
const MAX=1500;
function storage():Storage|null{
 try{return typeof window!=='undefined'?window.sessionStorage:null;}catch{return null;}
}
export function getNetworkAuditScenario():string{
 return storage()?.getItem(SCENARIO)??'default';
}
export function setNetworkAuditScenario(value:string):void{
 storage()?.setItem(SCENARIO,value.slice(0,50));
}
export function clearNetworkAudit():void{
 storage()?.removeItem(EVENTS);
}
function safeEvents():NetworkEvent[]{
 try{
  const found=storage()?.getItem(EVENTS);
  const parsed=found?JSON.parse(found):[];
  return Array.isArray(parsed)?parsed.slice(-MAX) as NetworkEvent[]:[];
 }catch{return [];}
}
/** Remove query values and path identifiers before writing even to sessionStorage. */
export function endpointLabel(raw:string):string{
 try{
  const url=new URL(raw,typeof window==='undefined'?'https://local.invalid':window.location.origin);
  let path=url.pathname;
  path=path.replace(/(\/gtfs\/(?:trips|stoptimes)\/)[^/]+/g,'$1:id');
  path=path.replace(/(\/public\/gtfs\/trips\/)[^/]+/g,'$1:id');
  const keys=[...new Set(url.searchParams.keys())].filter(k=>/^(routeShortName|includeNotTracking|limit|ids\[\]|names|stopId|date|scopes\[\])$/.test(k)).sort();
  return (url.host==='api.golemio.cz'?'golemio':url.host==='local.invalid'?'local':url.host)+path+(keys.length?'?'+keys.join('&'):'');
 }catch{return 'invalid-endpoint';}
}
export function recordNetworkEvent(entry:{
 source:string;url:string;kind:NetworkEventKind;status?:number|null;
 durationMs?:number|null;ttlMs?:number|null;
}):void{
 const store=storage();if(!store)return;
 try{
  const record:NetworkEvent={
   at:new Date().toISOString(),source:entry.source.slice(0,70),
   endpoint:endpointLabel(entry.url),kind:entry.kind,
   status:entry.status??null,
   durationMs:entry.durationMs===undefined?null:Math.max(0,Math.round(entry.durationMs??0)),
   ttlMs:entry.ttlMs??null
  };
  const events=safeEvents();events.push(record);
  store.setItem(EVENTS,JSON.stringify(events.slice(-MAX)));
 }catch{/* Diagnostics must never break live tracking. */}
}
export function networkAuditReport():NetworkAuditReport{
 const events=safeEvents();
 const grouped=new Map<string,{endpoint:string;source:string;http:number;cache:number;coalesced:number;rejected:number;errors:number;rateLimited:number;totalMs:number;timed:number}>();
 for(const event of events){
  const key=event.source+'|'+event.endpoint;
  let row=grouped.get(key);
  if(!row){row={source:event.source,endpoint:event.endpoint,http:0,cache:0,coalesced:0,rejected:0,errors:0,rateLimited:0,totalMs:0,timed:0};grouped.set(key,row);}
  row[event.kind]++;
  if(event.kind==='http'&&event.status!==null&&event.status>=400)row.errors++;
  if(event.status===429)row.rateLimited++;
  if(event.kind==='http'&&event.durationMs!==null){row.totalMs+=event.durationMs;row.timed++;}
 }
 return {version:1,exportedAt:new Date().toISOString(),scenario:getNetworkAuditScenario(),events,
  summary:[...grouped.values()].map(({totalMs,timed,...rest})=>({...rest,meanDurationMs:timed?Math.round(totalMs/timed):null}))
   .sort((a,b)=>b.http-a.http||a.endpoint.localeCompare(b.endpoint))};
}
export function downloadNetworkAudit():void{
 if(typeof document==='undefined')return;
 const report=networkAuditReport();
 const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;a.download='casovac-api-audit-'+new Date().toISOString().slice(0,10)+'.json';
 a.click();window.setTimeout(()=>URL.revokeObjectURL(url),2000);
}
