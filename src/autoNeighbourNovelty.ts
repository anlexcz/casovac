/** Suppress an automatic board only when EVERY visible peer is already
 * known to have served the driver's immediately preceding physical platform.
 * A shared line number is insufficient: compare individual trip stop sequences.
 * Missing stop history never counts as a confirmed previously seen vehicle.
 */
import type {NeighbourResult} from './stopNeighbours.ts';

export function onlyPreviouslySharedPeers(
 result:NeighbourResult|null,
 precedingStopId:string|undefined,
 physicalStopMap:Readonly<Record<string,string>>
):boolean{
 if(!result||!precedingStopId||result.rows.length===0)return false;
 return result.rows.every(row=>{
  if(!row.previousId)return false;
  if(row.previousId===precedingStopId)return true;
  const ownPhysical=physicalStopMap[precedingStopId];
  const peerPhysical=physicalStopMap[row.previousId];
  return !!ownPhysical&&ownPhysical===peerPhysical;
 });
}
