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
 * The live trip must also be in the transition-stop neighbourhood on BOTH
 * sides; confirming a block does not authorize the whole downstream route.
 */
export function foreignLineAtTransition(args:{
 ownId:string;peerId:string;ownLine:string;peerLine:string;
 reference:Ref;links:ReadonlyMap<string,HeadwayLink>;
}):boolean{
 const {ownId,peerId,ownLine,peerLine,reference,links}=args;
 if(!ownLine||!peerLine||ownLine===peerLine)return false;
 const incoming=links.get(peerId);
 if(incoming&&incoming.firstId===peerId&&
  incoming.firstLine===peerLine&&incoming.secondLine===ownLine){
  // The concatenated peer itinerary can overlap our current line for many
  // stops AFTER the terminal. The old >= check admitted an incoming 9 even
  // when our 10 had travelled far beyond the 9→10 changeover.
  // Require BOTH trams to be at the terminal or its immediately adjacent
  // stop; this is a spatial/route-stage check, NOT an arbitrary time window.
  const boundary=incoming.boundaryIndex;
  if(reference.peerIndex>=boundary-1&&reference.peerIndex<=boundary&&
   reference.peerRef>=boundary&&reference.peerRef<=boundary+1)
   return true;
 }
 const outgoing=links.get(ownId);
 if(outgoing&&outgoing.firstId===ownId&&
  outgoing.firstLine===ownLine&&outgoing.secondLine===peerLine){
  const boundary=outgoing.boundaryIndex;
  // The selected tram is at the END of the current route, while the peer
  // is at the START of the newly linked route. Do not keep comparing the
  // second route far along either leg of a concatenated itinerary.
  if(reference.ownIndex>=boundary-1&&reference.ownIndex<=boundary&&
   reference.ownRef>=boundary-1&&reference.ownRef<=boundary+1&&
   reference.peerIndex<=1)
   return true;
 }
 return false;
}
