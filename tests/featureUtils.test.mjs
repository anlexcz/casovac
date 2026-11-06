import test from 'node:test';
import assert from 'node:assert/strict';
import {path,normalize,orderOf,selectedTripId,vehicleId,text} from '../src/featureUtils.ts';

const feature=(trip={})=>({properties:{trip}});
test('reads nested Golemio fields without crashing on absent objects',()=>{
 assert.equal(path(null,'properties.trip.id'),undefined);
 assert.equal(path({properties:{trip:{id:'x'}}},'properties.trip.id'),'x');
 assert.equal(path({properties:[]},'properties.trip.id'),undefined);
});
test('identifies trip using GTFS before legacy trip ID',()=>{
 assert.equal(selectedTripId(feature({gtfs:{trip_id:'GTFS'},trip_id:'OLD'})),'GTFS');
 assert.equal(selectedTripId(feature({trip_id:'OLD'})),'OLD');
 assert.equal(selectedTripId(feature()),'—');
});
test('resolves vehicle with established precedence',()=>{
 assert.equal(vehicleId(feature({vehicle_registration_number:'9170',vehicle:{id:'x'},vehicle_id:'z'})),'9170');
 assert.equal(vehicleId(feature({vehicle:{id:'9383'}})),'9383');
 assert.equal(vehicleId(feature({vehicle_id:'fallback'})),'fallback');
 assert.equal(vehicleId(feature()),'—');
});
test('prioritizes operating order and retains zero as a valid value',()=>{
 assert.equal(orderOf(feature({sequence_id:0,cis:{order:25}})),0);
 assert.equal(orderOf(feature({cis:{order:25},order:7})),25);
 assert.equal(orderOf(feature({gtfs:{run_number:4}})),4);
});
test('normalizes leading zeroes without conflating missing display values',()=>{
 assert.equal(normalize('00025'),'25');
 assert.equal(normalize(0),'0');
 assert.equal(normalize('000'),'0');
 assert.equal(text(undefined),'—');
 assert.equal(text(0),'0');
});
