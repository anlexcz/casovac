import test from 'node:test';
import assert from 'node:assert/strict';
import {getStaticNeighbourStops,resolveNeighbourStops} from '../src/neighbourStatic.ts';

const day='2026-11-08';
const trip={id:'3_16930_261107',date:day,routeId:'L3',blockId:'B',
 stopTimes:[['U449Z5P',86900,86900,1,'1'],['U450Z1P',87500,87500,2,'1']]};
const rows=[
 {id:'U449Z5P',name:'Výstaviště',sequence:1,arrival:'24:08:20',departure:'24:08:20',
  lat:50.1,lon:14.4,platformCode:'A',physicalId:'123/1'},
 {id:'U450Z1P',name:'Strossmayerovo náměstí',sequence:2,
  arrival:'24:18:20',departure:'24:18:20',lat:50.2,lon:14.5,
  platformCode:'B',physicalId:'124/2'}
];
function mock({route='3',date=day,stopRows=rows}={}){
 const calls=[];
 const source={
  async getTripResolved(id,requested){calls.push('trip');return requested===day&&id===trip.id?
   {...trip,date}:null;},
  async getTripStops(){calls.push('stops');return stopRows;},
  async getRoutes(){calls.push('routes');return {L3:[route,'','','','','']};}
 };
 return {source,calls};
}
test('exact PID GTFS trip, date, line and boarding edge replace online detail',async()=>{
 const {source,calls}=mock();
 const stops=await getStaticNeighbourStops(trip.id,day,'U449Z5P','3',source);
 assert.deepEqual(stops.map(s=>s.id),['U449Z5P','U450Z1P']);
 assert.equal(stops[0].arrival,'24:08:20');
 assert.equal(stops[0].platformCode,'A');
 assert.deepEqual(calls,['trip','routes','stops']);
});
test('boarding edge cannot be guessed from stop name, nearby platform or physical ID',async()=>{
 const {source}=mock();
 assert.equal(await getStaticNeighbourStops(trip.id,day,'123/1','3',source),null);
 assert.equal(await getStaticNeighbourStops(trip.id,day,'U449Z6P','3',source),null);
});
test('wrong route, trip, or service day cannot produce a static neighbouring schedule',async()=>{
 const {source}=mock();
 assert.equal(await getStaticNeighbourStops(trip.id,day,'U449Z5P','17',source),null);
 assert.equal(await getStaticNeighbourStops('different',day,'U449Z5P','3',source),null);
 assert.equal(await getStaticNeighbourStops(trip.id,'2026-11-09','U449Z5P','3',source),null);
});
test('incomplete stop sequence or invalid hour never silently accepted',async()=>{
 for(const stopRows of [rows.slice(0,1),[{...rows[0],id:''},rows[1]],
  [{...rows[0],arrival:'BAD'},rows[1]], [{...rows[0],lat:null},rows[1]]]){
  const {source}=mock({stopRows});
  assert.equal(await getStaticNeighbourStops(trip.id,day,'U449Z5P','3',source),null);
 }
});
test('fallback is called only when static validation fails or source is disabled',async()=>{
 const {source}=mock();
 let count=0;
 const fallback=async()=>{count++;return [{...rows[0],arrival:'12:00:00'}];};
 const accepted=await resolveNeighbourStops({tripId:trip.id,date:day,boardStopId:'U449Z5P',
  routeShortName:'3',staticAllowed:true,fallback,source});
 assert.equal(accepted.source,'PID GTFS');
 assert.equal(count,0);
 const rejected=await resolveNeighbourStops({tripId:trip.id,date:day,boardStopId:'U449Z6P',
  routeShortName:'3',staticAllowed:true,fallback,source});
 assert.equal(rejected.source,'Golemio');
 assert.equal(count,1);
 const disabled=await resolveNeighbourStops({tripId:trip.id,date:day,boardStopId:'U449Z5P',
  routeShortName:'3',staticAllowed:false,fallback,source});
 assert.equal(disabled.source,'Golemio');
 assert.equal(count,2);
});
test('a temporary PID failure must not blank the board candidate',async()=>{
 const {source}=mock();
 source.getTripResolved=async()=>{throw Error('PID GTFS unavailable');};
 let fallback=0;
 const result=await resolveNeighbourStops({tripId:trip.id,date:day,boardStopId:'U449Z5P',
  routeShortName:'3',staticAllowed:true,source,fallback:async()=>{
   fallback++;return [{...rows[0]}];
  }});
 assert.equal(result.source,'Golemio');
 assert.equal(result.stops.length,1);
 assert.equal(fallback,1);
});
