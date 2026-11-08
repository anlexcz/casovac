import test from 'node:test';
import assert from 'node:assert/strict';
import {VehicleObservationStore} from '../src/vehicleObservationStore.ts';
const feature=(id,at,car='9272')=>({properties:{trip:{gtfs:{trip_id:id,route_short_name:'5'},
 vehicle_registration_number:car},last_position:{
 origin_timestamp:new Date(at).toISOString(),state_position:'on_track',
 delay:{actual:30}}}});
test('empty response and older observation never erase a confirmed position',()=>{
 const cache=new VehicleObservationStore(),now=Date.now();
 assert.equal(cache.observe('2026-11-08',feature('a',now-1000),now),true);
 cache.observeMany('2026-11-08',[],now+20000);
 assert.equal(cache.observe('2026-11-08',feature('a',now-2000),now),false);
 assert.equal(cache.get('2026-11-08','a')?.vehicle,'9272');
 assert.equal(cache.quality('2026-11-08','a',now+100000),'last-known');
 assert.equal(cache.quality('2026-11-08','a',now+185000),'expired');
});
test('a new confirmed trip measurement replaces the old one without resetting the clock on duplicate HTTP',()=>{
 const store=new VehicleObservationStore(),now=Date.now();
 assert.equal(store.observe('d',feature('a',now-5000),now),true);
 assert.equal(store.observe('d',feature('a',now-5000),now+30000),false);
 assert.equal(store.get('d','a')?.receivedAt,now);
 assert.equal(store.observe('d',feature('a',now+1000,'9340'),now+2000),true);
 assert.equal(store.get('d','a')?.vehicle,'9340');
});
test('same trip ID from another day cannot inherit a previous vehicle',()=>{
 const store=new VehicleObservationStore(),now=Date.now();
 store.observe('2026-11-08',feature('a',now),now);
 assert.equal(store.retained('2026-11-09','a',now),null);
});