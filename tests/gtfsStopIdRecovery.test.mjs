import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStops,mergeVerifiedStopIds} from '../src/tripData.ts';
const record=(sequence,name,time,stop={})=>({
 stop_sequence:sequence,stop_name:name,arrival_time:time,departure_time:time,stop
});
test('GTFS nested stop properties expose authoritative platform ID',()=>{
 const rows=parseStops({stop_times:[
  record(1,'Vltavská','10:49:00',{properties:{stop_id:'U123Z1P'}}),
  record(2,'Štvanice','10:51:00',{properties:{id:'U124Z1P'}})
 ]});
 assert.deepEqual(rows.map(stop=>stop.id),['U123Z1P','U124Z1P']);
});
test('alternate stop-times fill only identical sequence, name and timetable',()=>{
 const primary=parseStops({stop_times:[
  record(1,'Vltavská','10:49:00'),
  record(2,'Štvanice','10:51:00')
 ]});
 const alternate=parseStops({stop_times:[
  {...record(1,'Vltavská','10:49:00'),stop_id:'U123Z1P'},
  {...record(2,'Štvanice','10:52:00'),stop_id:'U124Z1P'}
 ]});
 const merged=mergeVerifiedStopIds(primary,alternate);
 assert.equal(merged[0].id,'U123Z1P');
 assert.equal(merged[1].id,'');
});
test('ambiguous secondary records cannot fabricate a boarding edge',()=>{
 const primary=parseStops({stop_times:[record(1,'Vltavská','10:49:00')]});
 const alternate=parseStops({stop_times:[
  {...record(1,'Vltavská','10:49:00'),stop_id:'U1'},
  {...record(1,'Vltavská','10:49:00'),stop_id:'U2'}
 ]});
 assert.equal(mergeVerifiedStopIds(primary,alternate)[0].id,'');
});
