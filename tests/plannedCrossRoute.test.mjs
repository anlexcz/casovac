import test from 'node:test';
import assert from 'node:assert/strict';
import {findPlannedHeadways} from '../src/plannedHeadways.ts';

const day='2026-11-08';
const S='terminal-platform',T='next-platform',P='previous-platform';
const hhss=n=>[Math.floor(n/3600),Math.floor((n%3600)/60),n%60]
 .map(x=>String(x).padStart(2,'0')).join(':');
const trip=(id,route,block,legs)=>({
 id,date:day,routeId:'L'+route,blockId:block,
 headsign:'Směr',serviceId:'A',directionId:'0',shapeId:'shape',
 shortName:'',stopTimes:legs.map(([stop,time],index)=>
  [stop,time,time,index+1,'1'])
});
const stopRows=t=>t.stopTimes.map(([id,a,d,seq])=>({
 id,name:id===S?'Terminál':id,sequence:seq,
 arrival:hhss(a),departure:hhss(d),lat:50.1+seq*.001,
 lon:14.4+seq*.001,physicalId:id,platformCode:'A'
}));
function fixture(trips){
 const map=new Map(trips.map(t=>[t.id,t]));
 const routes=Object.fromEntries(trips.map(t=>[t.routeId,
  [t.routeId.slice(1),'','','','','']]));
 const trace=[];
 return {map,source:{
  async getTripResolved(id,date){trace.push('resolved '+id);return date===day?map.get(id)??null:null;},
  async getTrip(id,date){trace.push('trip '+id);return date===day?map.get(id)??null:null;},
  async getTripStops(id,date){trace.push('stops '+id);return date===day&&map.has(id)?
   stopRows(map.get(id)):null;},
  async getDepartures(stopId,date){trace.push('departures '+stopId);
   return date===day?[...map.values()].flatMap(t=>
    t.stopTimes.filter(row=>row[0]===stopId).map(([id,a,d,seq])=>({
     stopId,date,departureSeconds:d,tripId:t.id,
     routeId:t.routeId,stopSequence:seq
    }))):[];
  },
  async getRoutes(){return routes;},
  async getBlockTrips(blockId,date){trace.push('block '+blockId);
   return date===day?[...map.values()].filter(t=>t.blockId===blockId)
    .map(t=>({id:t.id,date,routeId:t.routeId,
     startSeconds:t.stopTimes[0][2]})):[];
  }
 },trace};
}
const minute=60;
test('arbitrary 12 → 17: verified incoming foreign route is PLAN ahead at the terminal',async()=>{
 const f=fixture([
  trip('own','17','OWN',[[S,720*minute],[T,730*minute]]),
  trip('incoming','12','CHAIN',[[P,708*minute],[S,716*minute]]),
  trip('continuation','17','CHAIN',[[S,721*minute],[T,731*minute]]),
  trip('unrelated','24','NONE',[[P,709*minute],[S,717*minute]])
 ]);
 const result=await findPlannedHeadways({tripId:'own',date:day,
  referenceStopId:S,source:f.source});
 assert.equal(result.status,'ready');
 assert.equal(result.ahead?.tripId,'incoming');
 assert.equal(result.ahead?.line,'12');
 assert.equal(result.ahead?.scheduledGap,240);
 assert.equal(result.behind?.tripId,'continuation');
 assert.equal(result.behind?.line,'17');
 assert.equal(result.behind?.scheduledGap,60);
 assert.equal(f.trace.some(x=>x==='block CHAIN'),true);
 assert.equal(f.trace.some(x=>x.includes('golemio')),false);
});
test('arbitrary 5 → 6: verified outgoing foreign route is PLAN behind at the terminal',async()=>{
 const f=fixture([
  trip('own','5','OWN',[[P,708*minute],[S,720*minute]]),
  trip('previous','5','CHAIN',[[P,710*minute],[S,718*minute]]),
  trip('outgoing','6','CHAIN',[[S,724*minute],[T,734*minute]]),
  trip('unknown','24','NONE',[[S,722*minute],[T,732*minute]])
 ]);
 const result=await findPlannedHeadways({tripId:'own',date:day,
  referenceStopId:S,source:f.source});
 assert.equal(result.status,'ready');
 assert.equal(result.behind?.tripId,'outgoing');
 assert.equal(result.behind?.line,'6');
 assert.equal(result.behind?.scheduledGap,240);
 assert.equal(result.ahead,null);
});
test('no whitelist: 17 → 24 or 12 → 17 → 24 works with same generic block rule',async()=>{
 const f=fixture([
  trip('own','24','OWN',[[S,720*minute],[T,730*minute]]),
  trip('incoming','17','CHAIN',[[P,710*minute],[S,716*minute]]),
  trip('further','24','CHAIN',[[S,722*minute],[T,732*minute]]),
  trip('earlier','12','CHAIN',[[P,700*minute],[P,705*minute]])
 ]);
 const result=await findPlannedHeadways({tripId:'own',date:day,
  referenceStopId:S,source:f.source});
 assert.equal(result.ahead?.line,'17');
 assert.equal(result.behind?.line,'24');
});
test('shared tracks alone must not authorize cross-line planned spacing',async()=>{
 const f=fixture([
  trip('own','17','OWN',[[S,720*minute],[T,730*minute]]),
  trip('unrelated','24','NONE',[[S,718*minute],[T,728*minute]])
 ]);
 const result=await findPlannedHeadways({tripId:'own',date:day,
  referenceStopId:S,source:f.source});
 assert.equal(result.ahead,null);
 assert.equal(result.behind,null);
});
test('no cross-line matches away from precise terminal boundary',async()=>{
 const f=fixture([
  trip('own','17','OWN',[[P,710*minute],[S,720*minute],[T,730*minute]]),
  trip('incoming','12','CHAIN',[[P,708*minute],[S,716*minute]]),
  trip('continuation','17','CHAIN',[[S,721*minute],[T,731*minute]])
 ]);
 const result=await findPlannedHeadways({tripId:'own',date:day,
  referenceStopId:S,source:f.source});
 assert.equal(result.ahead,null);
 assert.equal(result.behind?.tripId,'continuation');
});
test('no cross-line estimate without verified block endpoints',async()=>{
 const f=fixture([
  trip('own','17','OWN',[[S,720*minute],[T,730*minute]]),
  trip('incoming','12','CHAIN',[[P,708*minute],[S,716*minute]]),
  trip('continuation','17','CHAIN',[[P,721*minute],[T,731*minute]])
 ]);
 const result=await findPlannedHeadways({tripId:'own',date:day,
  referenceStopId:S,source:f.source});
 assert.equal(result.ahead,null);
});
test('legacy same-route source without block methods still works',async()=>{
 const f=fixture([
  trip('own','17','OWN',[[S,720*minute],[T,730*minute]]),
  trip('same','17','ANOTHER',[[S,716*minute],[T,726*minute]]),
  trip('foreign','12','CHAIN',[[P,708*minute],[S,717*minute]])
 ]);
 delete f.source.getTrip;
 delete f.source.getBlockTrips;
 const result=await findPlannedHeadways({tripId:'own',date:day,
  referenceStopId:S,source:f.source});
 assert.equal(result.ahead?.tripId,'same');
 assert.equal(result.ahead?.line,'17');
});
