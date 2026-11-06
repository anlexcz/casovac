import type {ChainSnapshot,ChainTrip} from './chainDiagnostics';
import type {Stop} from './tripData';
import {sameTransitionStop} from './terminalMatch';
import type {RemoteState} from './remoteTracking';
import type {DepartureTelemetry} from './departure';
import type {RemoteProgress} from './remoteProgress';

export type PlannedHandoff={next:ChainTrip;reason:string};
const stamp=(value:unknown):number|null=>{
 const n=typeof value==='string'?Date.parse(value):typeof value==='number'?value:NaN;
 return Number.isFinite(n)?n:null;
};
const clock=(v:string):number|null=>{
 const match=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
 if(!match)return null;
 return Number(match[1])*3600+Number(match[2])*60+Number(match[3]??0);
};
// The other route is a candidate only, never proof of the GTFS connection.
export function findPlannedHandoff(
 snapshot:ChainSnapshot|null,current:{line:string;order:string;tripId:string;vehicle:string;start:unknown},
 now:number
):PlannedHandoff|null{
 if(!snapshot||snapshot.error||now-snapshot.time>120000||
   snapshot.target!==current.line+'/'+current.order||
   !current.tripId)return null;
 const currentStart=stamp(current.start);
 const candidates=snapshot.related.filter(next=>{
  const nextStart=stamp(next.start);
  return (next.order===current.order||!!current.vehicle&&next.vehicle===current.vehicle)&&
   next.line===snapshot.relatedLine&&
   next.tripId!==current.tripId&&/^\d+$/.test(next.order)&&!!next.tripId&&
   (next.state.startsWith('before_track')||next.state==='at_stop'||next.state==='on_track')&&nextStart!==null&&
   nextStart>=now-10*60000&&nextStart<=now+90*60000&&
   (currentStart===null||nextStart>currentStart);
 }).sort((a,b)=>{
  const score=(f:ChainTrip)=>(f.order===current.order?0:1)+(f.vehicle===current.vehicle?0:2);
  return score(a)-score(b)||(stamp(a.start)??0)-(stamp(b.start)??0);
 });
 if(!candidates.length)return null;
 // More than one plausible successor at almost the same time is ambiguous.
 if(candidates.length>1&&
   Math.abs((stamp(candidates[1].start)??0)-(stamp(candidates[0].start)??0))<120000)return null;
 return {next:candidates[0],reason:candidates[0].order===current.order?
  'Navazující trip stejného provozního pořadí.':'Kandidát se stejným vozem; pořadí se může měnit.'};
}
export function verifyHandoffStops(oldStops:Stop[],newStops:Stop[]):{ok:boolean;reason:string}{
 if(oldStops.length<2||newStops.length<2)return {ok:false,reason:'Chybí úplný jízdní řád jednoho z tripů.'};
 const from=oldStops[oldStops.length-1],to=newStops[0];
 if(!sameTransitionStop(from,to))
  return {ok:false,reason:'Přechodová zastávka se neshoduje identifikátorem ani polohou.'};
 const arrival=clock(from.arrival||from.departure),departure=clock(to.departure||to.arrival);
 if(arrival===null||departure===null)return {ok:false,reason:'Chybí časy přechodové zastávky.'};
 // A genuine chained service can wait at the terminal before departing.
 // GTFS also allows 24:xx and transitions across service-day midnight.
 const differences=[-86400,0,86400].map(offset=>departure+offset-arrival);
 const interval=differences.find(diff=>diff>=-180&&diff<=30*60);
 if(interval===undefined)return {ok:false,reason:'Návazný odjezd není do 30 minut od příjezdu na konečnou.'};
 return {ok:true,reason:interval>180?
  'Shodná přechodová zastávka; navazující odjezd po čekání na konečné.':
  'Shodná přechodová zastávka a čas navazujících tripů.'};
}
export function departureForHandoff(args:{
 remote:RemoteState;progress:RemoteProgress;gpsDeparture:DepartureTelemetry;
 stopsCount:number;apiAge:number|null;now:number;sourceTripState:string;
}):{ok:boolean;reason:string}{
 const {remote,progress,gpsDeparture,stopsCount,apiAge}=args;
 const last=stopsCount-1,penultimate=last-1;
 if(last<1)return {ok:false,reason:'Trip je příliš krátký.'};
 if(apiAge===null||apiAge>50||remote.sourceAge===null||remote.sourceAge>90||
    remote.status==='off-route'||remote.status==='stale')
  return {ok:false,reason:'Čekám na čerstvou a věrohodnou polohu.'};
 if(gpsDeparture.phase==='left'&&gpsDeparture.displayIndex===last)
  return {ok:true,reason:'GPS potvrdila odjezd z předposlední zastávky.'};
 if(remote.vehicleState==='on_track'&&remote.previousIndex===penultimate&&remote.nextIndex===last)
  return {ok:true,reason:'Golemio hlásí jízdu z předposlední do poslední zastávky.'};
 if(remote.vehicleState==='at_stop'&&remote.previousIndex===penultimate&&
   remote.nextIndex===last&&progress.predicted&&progress.index===last)
  return {ok:true,reason:'Potvrzená predikce odjezdu z předposlední zastávky.'};
 return {ok:false,reason:'Vůz dosud nepotvrdil odjezd z předposlední zastávky.'};
}
