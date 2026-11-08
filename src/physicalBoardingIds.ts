/** Phase 5B: use only the authoritative PID physical-platform registry.
 * Multiple GTFS stop IDs may represent one real boarding edge.
 * Never fall back to name matching or nearby coordinates.
 */
import {pidStatic} from './pidStatic.ts';
import type {PidStaticEngine} from './pidStatic.ts';

type Registry=Pick<PidStaticEngine,'getStopMap'|'getPlatforms'>;

export async function physicalBoardingIds(stopId:string,source:Registry=pidStatic):Promise<string[]>{
 if(!stopId)return [];
 const mapping=await source.getStopMap();
 const physical=mapping[stopId];
 if(!physical)return [stopId]; // Unmapped: stay on exact GTFS edge.
 const platforms=await source.getPlatforms();
 const row=platforms[physical];
 if(!row||!Array.isArray(row[7])||!row[7].includes(stopId))
  return [stopId]; // Corrupt registry: never expand beyond exact ID.
 const siblings=[...new Set(row[7].filter(id=>id===stopId||mapping[id]===physical))];
 return siblings.length?siblings:[stopId];
}
