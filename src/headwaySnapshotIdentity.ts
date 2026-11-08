/** A headway sample belongs to a pair of scheduled DUTIES, never to the
 * currently displayed stop or the specific GTFS successor trip. Both sides
 * are included so a truly different neighbour can never inherit the number.
 */
export type HeadwaySide='ahead'|'behind';
export function headwaySnapshotKey(args:{
 date:string;ownDutyId:string;peerDutyId:string;side:HeadwaySide;
}):string{
 const {date,ownDutyId,peerDutyId,side}=args;
 return JSON.stringify([date,ownDutyId,side,peerDutyId]);
}
/** A provisional trip ID can safely be promoted to a confirmed block ID
 * only if it still refers to the SAME previously selected original peer.
 */
export function mayPromoteHeadwaySnapshot(args:{
 previousPeerTrip:string;nextPeerTrip:string;
 previousOwnDuty:string;nextOwnDuty:string;
 previousKey:string;nextKey:string;
}):boolean{
 return args.previousKey!==args.nextKey&&
  !!args.previousPeerTrip&&args.previousPeerTrip===args.nextPeerTrip&&
  args.previousOwnDuty===args.nextOwnDuty;
}
