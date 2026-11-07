/**
 * Once an automatic platform sheet appears, it stays open independently of
 * subsequent Golemio responses. Only advancing beyond its stop or changing
 * the tracked GTFS trip ends that automatic session.
 */
export function isAutoStopActive(
 pinned:{tripId:string;index:number}|null,
 tripId:string,
 currentIndex:number|null,
 stopCount:number
):boolean{
 return pinned!==null&&pinned.tripId===tripId&&currentIndex!==null&&
  currentIndex<=pinned.index&&pinned.index>=0&&pinned.index<stopCount;
}
