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
 if(expectedDifference===null||!Number.isFinite(expectedDifference))return 'neutral';
 // Equal scheduled times have no fixed order to flip. Flag only an actually
 // near-simultaneous predicted arrival; never manufacture a green/red ranking.
 if(relative==='same')return Math.abs(expectedDifference)<=Math.max(0,Math.min(300,tolerance))?
  'uncertain':'neutral';
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

/** Short HH:mm estimate for a scheduled GTFS service time and live offset.
 * GTFS clock values can exceed 24h and negative deviations can cross midnight.
 * Nearest-minute rounding avoids displaying 13:47 for 13:47:59.
 */
export function predictedArrivalClock(scheduled:number,delay:number|null):string|null{
 if(!Number.isFinite(scheduled)||delay===null||!Number.isFinite(delay))return null;
 const minutes=((Math.round((scheduled+delay)/60)%1440)+1440)%1440;
 return String(Math.floor(minutes/60)).padStart(2,'0')+':'+
  String(minutes%60).padStart(2,'0');
}
