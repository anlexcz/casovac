/** Suppress an automatic board only when EVERY visible peer was already
 * scheduled to share the immediately preceding physical platform at roughly
 * the same time. Line number or physical platform alone is not sufficient:
 * services may use the same stop many minutes apart.
 * Missing trip stop history/time is not grounds for suppressing an alert.
 */
import type {NeighbourResult} from './stopNeighbours.ts';
import type {Stop} from './tripData.ts';

const seconds=(value:string):number|null=>{
 const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
 if(!m||Number(m[2])>59||Number(m[3]??0)>59)return null;
 return Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0);
};
export function onlyPreviouslySharedPeers(
 result:NeighbourResult|null,
 precedingStop:Stop|undefined,
 physicalStopMap:Readonly<Record<string,string>>,
 toleranceSeconds=120
):boolean{
 if(!result||!precedingStop?.id||result.rows.length===0)return false;
 const ownTime=seconds(precedingStop.arrival||precedingStop.departure);
 if(ownTime===null)return false;
 return result.rows.every(row=>{
  if(!row.previousId||row.previousScheduledSeconds===null||
   row.previousScheduledSeconds===undefined)return false;
  const identical=row.previousId===precedingStop.id;
  const ownPhysical=physicalStopMap[precedingStop.id];
  const peerPhysical=physicalStopMap[row.previousId];
  if(!identical&&(!ownPhysical||ownPhysical!==peerPhysical))return false;
  // Two services using a stop ten minutes apart have not 'already met'.
  // Use fresh known delays only when BOTH are present, otherwise compare the
  // planned stop-time window (or remain conservative if only one delay exists).
  if((result.ownDelay===null)!==(row.delay===null))return false;
  const difference=row.previousScheduledSeconds+(row.delay??0)-
   (ownTime+(result.ownDelay??0));
  return Math.abs(difference)<=toleranceSeconds;
 });
}
