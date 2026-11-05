import type {Stop} from './tripData';
import {distanceMeters,normalizedStopId} from './position';

export type StopAuditStatus='exact'|'normalized'|'base-unique'|'base-ambiguous'|'unmatched'|'missing';
export type StopAuditCandidate={index:number;sequence:number;id:string;name:string;departure:string;meters:number|null};
export type StopAudit={
 liveId:string;normalizedLiveId:string;liveBase:string|null;status:StopAuditStatus;
 exact:StopAuditCandidate[];sameBase:StopAuditCandidate[];nearest:StopAuditCandidate[];
 stopCount:number;missingGtfsIds:number;uniqueGtfsIds:number;duplicateGtfsIds:number;
 message:string;
};
export function stopBase(id:string):string|null{
 const match=/^U(\d+)Z\d+[A-Z0-9]*$/.exec(normalizedStopId(id));
 return match?'U'+match[1]:null;
}
function candidate(stop:Stop,index:number,vehicle:[number,number]|null):StopAuditCandidate{
 const meters=stop.lat!==null&&stop.lon!==null&&vehicle?
 distanceMeters(vehicle[1],vehicle[0],stop.lat,stop.lon):null;
 return {index,sequence:stop.sequence,id:stop.id,name:stop.name,departure:stop.departure||stop.arrival,meters};
}
export function auditStopIds(stops:Stop[],liveId:string,vehicle:[number,number]|null):StopAudit{
 const normalizedLiveId=normalizedStopId(liveId);
 const liveBase=stopBase(liveId);
 const counted=new Map<string,number>();
 for(const s of stops){
  const key=normalizedStopId(s.id);
  if(key)counted.set(key,(counted.get(key)??0)+1);
 }
 const missingGtfsIds=stops.filter(s=>!normalizedStopId(s.id)).length;
 const duplicateGtfsIds=[...counted.values()].reduce((n,count)=>n+(count>1?count:0),0);
 const all=stops.map((s,i)=>candidate(s,i,vehicle));
 const exact=normalizedLiveId&&normalizedLiveId!=='—'
  ? all.filter(s=>s.id===liveId):[];
 const normalized=normalizedLiveId&&normalizedLiveId!=='—'
  ? all.filter(s=>normalizedStopId(s.id)===normalizedLiveId):[];
 const sameBase=liveBase?all.filter(s=>stopBase(s.id)===liveBase):[];
 const nearest=all.filter(s=>s.meters!==null).sort((a,b)=>(a.meters??Infinity)-(b.meters??Infinity)).slice(0,5);
 let status:StopAuditStatus='unmatched';
 let message='Kód živé zastávky nemá v načteném tripu odpovídající ID.';
 if(!normalizedLiveId||normalizedLiveId==='—'){status='missing';message='Živý identifikátor zastávky není k dispozici.';}
 else if(exact.length){status='exact';message=exact.length===1?'Shoda přesného ID v GTFS.':'Přesné ID se v tripu opakuje; rozhoduje pořadí průjezdu.';}
 else if(normalized.length){status='normalized';message=normalized.length===1?'Shoda po normalizaci zápisu ID.':'Normalizované ID se v tripu opakuje.';}
 else if(liveBase&&sameBase.length===1){status='base-unique';message='Shoda základního kódu zastávky; konkrétní nástupiště může být jiné. Pouze diagnostika.';}
 else if(liveBase&&sameBase.length>1){status='base-ambiguous';message='Základní kód odpovídá více zastávkám či nástupištím. Nelze automaticky spojit.';}
 return {liveId,normalizedLiveId,liveBase,status,exact:exact.length?exact:normalized,sameBase,nearest,
  stopCount:stops.length,missingGtfsIds,uniqueGtfsIds:counted.size,duplicateGtfsIds,message};
}
export function stopAuditReport(audit:StopAudit,tripId:string):string{
 const rows=(c:StopAuditCandidate[])=>c.map(s=>`${s.sequence}. ${s.name} | ${s.id||'(bez ID)'} | ${s.departure||'—'} | ${s.meters===null?'souřadnice neznámé':s.meters+' m'}`);
 return [
 'ČASOVAČ / AUDIT ID ZASTÁVEK',
 'Trip: '+tripId,
 'Živé ID: '+audit.liveId,
 'Normalizované ID: '+audit.normalizedLiveId,
 'Základ ID: '+(audit.liveBase??'—'),
 'Výsledek: '+audit.status,
 audit.message,
 'GTFS zastávky: '+audit.stopCount,
 'Chybějící GTFS ID: '+audit.missingGtfsIds,
 'Unikátní GTFS ID: '+audit.uniqueGtfsIds,
 'Výskyty duplicitních ID: '+audit.duplicateGtfsIds,
 '',
 'Přesné/normalizované shody:',...(rows(audit.exact).length?rows(audit.exact):['žádné']),
 '',
 'Shody základního kódu:',...(rows(audit.sameBase).length?rows(audit.sameBase):['žádné']),
 '',
 'Nejbližší zastávky k vozidlu:',...(rows(audit.nearest).length?rows(audit.nearest):['bez polohy']),
 '',
 'Zastávky GTFS (pořadí | název | ID):'
 ].join('\n');
}
