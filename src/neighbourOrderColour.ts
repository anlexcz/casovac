import type {NeighbourRow} from './stopNeighbours.ts';

export type OrderColour='good'|'risk'|'uncertain'|'neutral';
/**
 * The arrow is solely scheduled order. Colour is a separate, approximate
 * prediction. Positive difference means the peer is later than own ETA.
 */
export function orderColour(
 relative:NeighbourRow['relative'],
 expectedDifference:number|null,
 tolerance=30,
 previous:OrderColour='neutral',
 hysteresis=10
):OrderColour{
 if(relative==='same'||expectedDifference===null||!Number.isFinite(expectedDifference))return 'neutral';
 const correctlyOrdered=relative==='before'?-expectedDifference:expectedDifference;
 const margin=Math.max(0,Math.min(300,tolerance));
 const band=Math.max(0,Math.min(60,hysteresis));
 if(previous==='good'&&correctlyOrdered>margin-band)return 'good';
 if(previous==='risk'&&correctlyOrdered< -margin+band)return 'risk';
 if(previous==='uncertain'&&Math.abs(correctlyOrdered)<margin+band)return 'uncertain';
 if(correctlyOrdered>margin)return 'good';
 if(correctlyOrdered< -margin)return 'risk';
 return 'uncertain';
}
export function scheduledSeconds(value:string):number|null{
 const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
 if(!m)return null;
 return Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0);
}
