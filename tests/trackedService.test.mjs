import test from 'node:test';
import assert from 'node:assert/strict';
import {operatingDate,serviceFromFeature,unverifiedService,serviceKey,
 observeService,withCurrentRoute,parseTrackedService} from '../src/trackedService.ts';
import {decodeStoredService} from '../src/trackingStorage.ts';

const f=(line,origin,order,car,trip='2_16346_260926')=>({
 properties:{trip:{gtfs:{route_short_name:line,trip_id:trip},
  origin_route_name:origin,sequence_id:order,vehicle_registration_number:car}}
});
const date='2026-11-07';
test('Golemio originRoute 91/71 stays separate from the current 2/71 and #8266',()=>{
 const item=serviceFromFeature(f('2','91',71,8266),date);
 assert.ok(item?.verified);
 assert.deepEqual([item.originRoute,item.sequenceId,item.currentRoute,item.vehicleId],
  ['91','71','2','8266']);
 assert.equal(serviceKey(item),'2026-11-07|91/71');
});
test('missing origin_route_name is UNKNOWN, never implicitly equal to current line',()=>{
 assert.equal(serviceFromFeature(f('2',null,71,8266),date),null);
 const legacy=unverifiedService('2','71',date);
 assert.equal(legacy.verified,false);
 assert.equal(legacy.originRoute,'');
 assert.equal(serviceKey(legacy),null);
});
test('same duty updates its vehicle and GTFS trip without changing stable key',()=>{
 const original=serviceFromFeature(f('2','91',71,8266),date);
 const replaced=observeService(original,f('2','91',71,8270,'next'),date,'2','71');
 assert.equal(replaced.vehicleId,'8270');
 assert.equal(replaced.currentTripId,'next');
 assert.equal(serviceKey(replaced),serviceKey(original));
});
test('confirmed line transition can update currentRoute without resetting stable identity',()=>{
 const original=serviceFromFeature(f('2','91',71,8266),date);
 const next=observeService(original,f('91','91',71,8266,'after'),date,'91','71');
 assert.equal(next?.currentRoute,'91');
 assert.equal(serviceKey(next),serviceKey(original));
 assert.equal(withCurrentRoute(original,'91','71')?.originRoute,'91');
 assert.equal(withCurrentRoute(original,'91','72'),null);
});
test('contradictory origin or order never reassigns selected duty',()=>{
 const original=serviceFromFeature(f('2','91',71,8266),date);
 assert.equal(observeService(original,f('2','92',71,8266),date,'2','71'),original);
 assert.equal(observeService(original,f('2','91',72,8266),date,'2','71'),original);
 assert.equal(observeService(original,f('2','91',71,8266),'2026-11-08','2','71'),original);
});
test('Prague day is captured once and remains stable across midnight',()=>{
 const before=operatingDate(Date.parse('2026-11-07T23:58:00+01:00'));
 const after=operatingDate(Date.parse('2026-11-08T00:06:00+01:00'));
 assert.equal(before,'2026-11-07');
 assert.equal(after,'2026-11-08');
 const s=serviceFromFeature(f('2','91',71,8266),before);
 assert.equal(serviceKey(s),'2026-11-07|91/71');
});
test('versioned persisted identity validates expiry, schema and keeps legacy unknown',()=>{
 const tracked=serviceFromFeature(f('2','91',71,8266),date);
 const raw=JSON.stringify({version:2,expires:200000,service:tracked});
 assert.deepEqual(decodeStoredService(raw,100000),tracked);
 assert.equal(decodeStoredService(raw,200000),null);
 assert.equal(decodeStoredService(JSON.stringify({version:1,expires:200000,service:tracked}),100000),null);
 assert.equal(parseTrackedService({...tracked,verified:true,originRoute:''}),null);
 const unknown=unverifiedService('2','71',date);
 assert.equal(parseTrackedService(unknown)?.verified,false);
});
