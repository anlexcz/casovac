import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptStaticTrip,loadVerifiedStaticTrip} from '../src/staticTripAdapter.ts';
import {decodeRoute} from '../src/departure.ts';
import {remoteEstimate} from '../src/remoteTracking.ts';

const trip={id:'9_12345_261108',date:'2026-11-08',routeId:'L9',
 serviceId:'A',headsign:'Sídliště Řepy',directionId:'0',blockId:'b9',
 shapeId:'s9',shortName:'',stopTimes:[
 ['U1',86430,86430,1,'1'],['U2',87120,87120,2,'1']]};
const stops=[
 {id:'U1',name:'Anděl',sequence:1,arrival:'24:00:30',departure:'24:00:30',lat:50,lon:14,platformCode:'A',physicalId:'1040/1'},
 {id:'U2',name:'Arbesovo náměstí',sequence:2,arrival:'24:12:00',departure:'24:12:00',lat:50.01,lon:14.01,platformCode:'B',physicalId:'4/2'}
];
const shape=[[50,14],[50.005,14.005],[50.01,14.01]];
test('static trip adapter preserves stop identities, 24h+ times and route geometry',()=>{
 const result=adaptStaticTrip(trip,stops,shape,'9');
 assert.deepEqual(result.stops.map(s=>s.id),['U1','U2']);
 assert.equal(result.stops[0].arrival,'24:00:30');
 assert.equal(result.route,'9');
 const route=decodeRoute(result.raw);
 assert.equal(route.length,3);
 assert.equal(route[0].lon,14);
 assert.equal(route[0].lat,50);
 assert.ok(route[2].metres>route[1].metres);
 // The legacy downstream APIs must be able to project against the static shape.
 const state=remoteEstimate({feature:null,stops:result.stops,raw:result.raw,
  tripId:trip.id,fetchedAt:null,now:Date.now(),history:null});
 assert.equal(state.status,'unknown');
});
test('adapter rejects incomplete geometry rather than degrading GPS tracking',()=>{
 assert.throws(()=>adaptStaticTrip(trip,stops,[], '9'),/geometrie/i);
 assert.throws(()=>adaptStaticTrip(trip,stops,[[50,14]],'9'),/geometrie/i);
 assert.throws(()=>adaptStaticTrip(trip,[{...stops[0],id:''}],shape,'9'),/zastávky/i);
});
test('static lookup works only for exact trip ID and provided service date',async()=>{
 const fake={
  getTrip:async(id,day)=>id===trip.id&&day==='2026-11-08'?trip:null,
  getTripStops:async()=>stops,
  getRouteShape:async()=>shape
 };
 const result=await loadVerifiedStaticTrip(trip.id,'2026-11-08','9',fake);
 assert.equal(result.stops.length,2);
 assert.equal(result.source,'PID GTFS · statický jízdní řád');
 await assert.rejects(loadVerifiedStaticTrip(trip.id,'2026-11-07','9',fake),/není v lokálním/);
 await assert.rejects(loadVerifiedStaticTrip(trip.id,'','9',fake),/provozní datum/);
});
test('missing shape and mismatched stop counts fail closed for Golemio fallback',async()=>{
 const fake={
  getTrip:async()=>trip,getTripStops:async()=>stops.slice(0,1),getRouteShape:async()=>shape
 };
 await assert.rejects(loadVerifiedStaticTrip(trip.id,'2026-11-08','9',fake),/sekvence/);
});
