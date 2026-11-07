import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateStopNeighbours,relevantWindows,DEFAULT_NEIGHBOUR_SETTINGS} from '../src/stopNeighbours.ts';
const now=Date.parse('2026-11-07T07:05:00+01:00');
const st=(id,clock)=>({id,name:id,sequence:1,arrival:clock,departure:clock,lat:null,lon:null});
const own=[st('A','07:58:00'),st('B','08:03:00'),st('C','08:07:00')];
const feature=(trip,line,order,car,next,delay=0)=>({
 properties:{trip:{gtfs:{trip_id:trip,route_short_name:line},sequence_id:order,vehicle_registration_number:car},
  last_position:{state_position:'on_track',origin_timestamp:new Date(now).toISOString(),
   next_stop:{id:next},delay:{actual:delay}}}
});
const selected=feature('me','17',5,9098,'A',240);
const before=feature('before','3',12,9154,'B',360);
const after=feature('after','7',8,9223,'B',120);
const equal=feature('equal','16',11,9141,'B',240);
const incorrectPlatform=feature('other-platform','21',4,9201,'B2',240);
const schedules=new Map([
 ['before',[st('X','07:55:00'),st('B','08:01:00'),st('Y','08:05:00')]],
 ['after',[st('X','08:01:00'),st('B','08:04:00'),st('Y','08:08:00')]],
 ['equal',[st('X','08:00:00'),st('B','08:03:00'),st('Y','08:08:00')]],
 ['other-platform',[st('X','08:00:00'),st('B2','08:03:00'),st('Y','08:08:00')]]
]);
const run=(peers=[after,equal,before,incorrectPlatform],opts={})=>calculateStopNeighbours({
 ownTripId:'me',ownStops:own,ownIndex:1,ownFeature:selected,candidates:peers,
 candidateStops:schedules,now,settings:{...DEFAULT_NEIGHBOUR_SETTINGS,enabled:true},distance:0,...opts
});
test('schedule determines ordering even when live arrival order differs',()=>{
 const rows=run().rows;
 assert.deepEqual(rows.map(x=>x.tripId),['before','equal','after']);
 assert.deepEqual(rows.map(x=>x.relative),['before','same','after']);
 assert.equal(rows[0].delay,360);
 assert.equal(rows[0].predictedDifference,0);
});
test('one exact stop ID suffices; other platform is excluded',()=>{
 assert.equal(run().rows.some(x=>x.tripId==='other-platform'),false);
});
test('joining or splitting route marks an important platform',()=>{
 assert.equal(run().significant,true);
 const sameStops=[st('A','08:00:00'),st('B','08:02:00'),st('C','08:08:00')];
 assert.equal(run([before],{candidateStops:new Map([['before',sameStops]])}).significant,false);
});
test('a very late planned predecessor remains displayed and before us',()=>{
 const late=feature('before','3',12,9154,'B',600);
 const r=run([late],{settings:{...DEFAULT_NEIGHBOUR_SETTINGS,enabled:true,window:'manual',beforeMinutes:2,afterMinutes:5}});
 assert.equal(r.rows[0].relative,'before');
 assert.equal(r.rows[0].predictedDifference,240);
});
test('window follows expected arrival and is adjustable',()=>{
 const moderatelyLate=feature('before','3',12,9154,'B',540);
 const narrow=run([moderatelyLate],{settings:{...DEFAULT_NEIGHBOUR_SETTINGS,enabled:true,window:'manual',beforeMinutes:1,afterMinutes:1}});
 assert.equal(narrow.rows.length,0);
 const wide=run([moderatelyLate],{settings:{...DEFAULT_NEIGHBOUR_SETTINGS,enabled:true,window:'manual',beforeMinutes:4,afterMinutes:4}});
 assert.equal(wide.rows.length,1);
 assert.deepEqual(relevantWindows(DEFAULT_NEIGHBOUR_SETTINGS,0),{before:120,after:180});
 assert.deepEqual(relevantWindows(DEFAULT_NEIGHBOUR_SETTINGS,5),{before:240,after:300});
});
test('vehicle that already passed the platform must be excluded',()=>{
 const passed=feature('before','3',12,9154,'Y',100);
 assert.equal(run([passed]).rows.length,0);
});

test('diverging line after the same incoming stop does not trigger automatic opening',()=>{
 const diverging=[st('A','08:00:00'),st('B','08:02:00'),st('Z','08:08:00')];
 const result=run([before],{candidateStops:new Map([['before',diverging]])});
 assert.equal(result.rows.length,1);
 assert.equal(result.significant,false);
});
test('different incoming branch at one shared platform triggers automatic opening',()=>{
 const arriving=[st('X','07:58:00'),st('B','08:01:00'),st('C','08:07:00')];
 const result=run([before],{candidateStops:new Map([['before',arriving]])});
 assert.equal(result.rows.length,1);
 assert.equal(result.significant,true);
});
