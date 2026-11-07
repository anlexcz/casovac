/** A route transition is not proof that *every* tram on both routes is
 * a comparable neighbour. The linked schedule must be an exact, verified
 * GTFS block with a common terminal and chronological boundary.
 */
export type HeadwayLink={
 firstId:string;secondId:string;firstLine:string;secondLine:string;
 boundaryIndex:number;
};
type Ref={ownIndex:number;peerIndex:number;ownRef:number;peerRef:number};

/** Foreign-line headways are meaningful only on the transition itself:
 * - another duty is still on the incoming line but its confirmed successor
 *   runs along our CURRENT line (approaching the boundary);
 * - our current first-leg tram is at its terminal and its confirmed next
 *   trip is the peer's current line (leaving the boundary).
 * Ordinary shared tracks of two different lines are NEVER sufficient.
 */
export function foreignLineAtTransition(args:{
 ownId:string;peerId:string;ownLine:string;peerLine:string;
 reference:Ref;links:ReadonlyMap<string,HeadwayLink>;
}):boolean{
 const {ownId,peerId,ownLine,peerLine,reference,links}=args;
 if(!ownLine||!peerLine||ownLine===peerLine)return false;
 const incoming=links.get(peerId);
 if(incoming&&incoming.firstId===peerId&&
  incoming.firstLine===peerLine&&incoming.secondLine===ownLine&&
  reference.peerIndex<=incoming.boundaryIndex&&
  reference.peerRef>=incoming.boundaryIndex){
  return true;
 }
 const outgoing=links.get(ownId);
 if(outgoing&&outgoing.firstId===ownId&&
  outgoing.firstLine===ownLine&&outgoing.secondLine===peerLine&&
  reference.ownIndex>=outgoing.boundaryIndex&&
  reference.ownRef>=outgoing.boundaryIndex){
  return true;
 }
 return false;
}
