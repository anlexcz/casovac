/** A failed refresh never destroys a previously measured headway.
 * Numerical last-known gaps are display-only; they are no longer LIVE once
 * either vehicle's source observation is >90 seconds old.
 */
export type HeadwaySnapshot={key:string;seconds:number;order:string;observedAt:number};
export type HeadwayView={seconds:number|null;quality:'live'|'last-known'|'plan';snapshot:HeadwaySnapshot|null};
export function stableHeadway(
 previous:HeadwaySnapshot|null,key:string,
 measured:{seconds:number;order:string}|null,observedAt:number|null,
 now:number
):HeadwayView{
 let snapshot=previous?.key===key?previous:null;
 if(measured&&observedAt!==null&&observedAt<=now+10000&&
  now-observedAt<=90000&&(!snapshot||observedAt>snapshot.observedAt)){
  snapshot={key,seconds:measured.seconds,order:measured.order,observedAt};
 }
 if(!snapshot)return {seconds:null,quality:'plan',snapshot:null};
 const age=now-snapshot.observedAt;
 if(age<0||age>180000)return {seconds:null,quality:'plan',snapshot:null};
 return {seconds:snapshot.seconds,quality:age<=90000?'live':'last-known',snapshot};
}
