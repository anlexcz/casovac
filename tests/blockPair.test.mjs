import test from 'node:test';
import assert from 'node:assert/strict';
import {findVerifiedBlockPair,validBlockBoundary} from '../src/blockPair.ts';
import {chainBoard} from '../src/chainStops.ts';

const stop=(id,seq,time,name=id)=>({
 stop_id:id,stop_sequence:seq,arrival_time:time,departure_time:time,
 stop:{properties:{stop_name:name},geometry:{coordinates:[14.44,50.10]}}
});
const first={trip_id:'6_30282_261019',block_id:'6_30282_261019',
 route:{route_short_name:'6'},stop_times:[stop('START',1,'13:10:00'),stop('U115Z4P',24,'13:49:00')]};
const second={trip_id:'5_21852_261019',block_id:'6_30282_261019',
 route:{route_short_name:'5'},stop_times:[stop('U115Z4P',1,'13:49:00'),stop('AFTER',2,'13:51:00')]};
const live=(line,tripId,vehicle='9140')=>({line,order:'5',tripId,vehicle,state:'before_track',
 start:'2026-11-06T13:49:00+01:00',lastStop:null,nextStop:null,rawTrip:null,source:'live'});
const select=(current,candidates)=>findVerifiedBlockPair(
 {tripId:current.trip_id,line:current.route.route_short_name,start:null,detail:current},
 candidates.map(([trip,detail])=>({trip,detail}))
);
test('online Golemio GTFS confirms actual 6/5 -> 5/5 block pair',()=>{
 const result=select(first,[[live('5',second.trip_id),second]]);
 assert.equal(result?.role,'first');
 assert.equal(result?.blockId,'6_30282_261019');
 assert.equal(result?.secondId,second.trip_id);
});
test('recognizes the predecessor when application is opened on second trip',()=>{
 const result=select(second,[[live('6',first.trip_id),first]]);
 assert.equal(result?.role,'second');
 assert.equal(result?.firstId,first.trip_id);
});
test('same vehicle and operating order are not proof without block equality',()=>{
 const unrelated={...second,block_id:'unrelated'};
 assert.equal(select(first,[[live('5',second.trip_id),unrelated]]),null);
});
test('rejects overlapping block with wrong transition platform',()=>{
 const mismatched={...second,stop_times:[stop('DIFFERENT',1,'13:49:00'),stop('AFTER',2,'13:51:00')]};
 assert.equal(select(first,[[live('5',second.trip_id),mismatched]]),null);
});
test('does not infer an unrelated pair from coincidental route and times',()=>{
 const singleton={...first,block_id:first.trip_id};
 const other={...second,block_id:second.trip_id};
 assert.equal(select(singleton,[[live('5',other.trip_id),other]]),null);
});
test('line order and car may differ while strict block identity still matches',()=>{
 const candidate=live('5',second.trip_id,'8888');candidate.order='42';
 assert.equal(select(first,[[candidate,second]])?.role,'first');
});
test('shared stop is only shown once; preceding note names the new line',()=>{
 const a=[{id:'START',name:'Start',arrival:'13:10:00',departure:'13:10:00',sequence:1,lat:null,lon:null},
  {id:'U115Z4P',name:'Nádraží Holešovice',arrival:'13:49:00',departure:'13:49:00',sequence:2,lat:null,lon:null}];
 const b=[{...a[1],sequence:1},{id:'AFTER',name:'Další',arrival:'13:51:00',departure:'13:51:00',sequence:2,lat:null,lon:null}];
 const forward=chainBoard(a,null,{line:'5',stops:b},'6');
 assert.deepEqual(forward.stops.map(x=>x.stop.id),['START','U115Z4P','AFTER']);
 assert.equal(forward.stops[1].changeTo,'5');
 const backwards=chainBoard(b,{line:'6',stops:a},null,'5');
 assert.deepEqual(backwards.stops.map(x=>x.stop.id),['START','U115Z4P','AFTER']);
 assert.equal(backwards.stops[1].changeTo,'5');
 assert.equal(backwards.offset,1);
 assert.equal(backwards.stops[1].localIndex,0);
});
test('extra repeated stops are retained, no dedup except one verified boundary',()=>{
 const a=[{id:'A',name:'A',arrival:'12:50:00',departure:'12:50:00',sequence:1,lat:null,lon:null},
  {id:'A',name:'A',arrival:'12:51:00',departure:'12:51:00',sequence:2,lat:null,lon:null},
  {id:'X',name:'X',arrival:'13:00:00',departure:'13:00:00',sequence:3,lat:null,lon:null}];
 const b=[{...a[2],sequence:1},{id:'X',name:'X',arrival:'13:01:00',departure:'13:01:00',sequence:2,lat:null,lon:null}];
 assert.deepEqual(chainBoard(a,null,{line:'9',stops:b},'10').stops.map(x=>x.stop.id),['A','A','X','X']);
});
test('terminal boundary tolerates an actual layover without a rigid 30-min cutoff',()=>{
 const a=[{id:'A',name:'A',arrival:'13:00:00',departure:'13:00:00',sequence:1,lat:null,lon:null},
  {id:'X',name:'X',arrival:'13:10:00',departure:'13:10:00',sequence:2,lat:null,lon:null}];
 const b=[{...a[1],arrival:'13:53:00',departure:'13:53:00',sequence:1},
  {id:'B',name:'B',arrival:'13:55:00',departure:'13:55:00',sequence:2,lat:null,lon:null}];
 assert.equal(validBlockBoundary(a,b),true);
});

test('rejects a trip starting an hour earlier on the same platform',()=>{
 const a=[{id:'A',name:'A',arrival:'13:00:00',departure:'13:00:00',sequence:1,lat:null,lon:null},
  {id:'X',name:'X',arrival:'14:00:00',departure:'14:00:00',sequence:2,lat:null,lon:null}];
 const b=[{...a[1],arrival:'13:00:00',departure:'13:00:00',sequence:1},
  {id:'B',name:'B',arrival:'13:05:00',departure:'13:05:00',sequence:2,lat:null,lon:null}];
 assert.equal(validBlockBoundary(a,b),false);
});
test('accepts a service-day rollover between 24:01 and 00:01',()=>{
 const a=[{id:'A',name:'A',arrival:'23:58:00',departure:'23:58:00',sequence:1,lat:null,lon:null},
  {id:'X',name:'X',arrival:'24:01:00',departure:'24:01:00',sequence:2,lat:null,lon:null}];
 const b=[{...a[1],arrival:'00:01:00',departure:'00:01:00',sequence:1},
  {id:'B',name:'B',arrival:'00:05:00',departure:'00:05:00',sequence:2,lat:null,lon:null}];
 assert.equal(validBlockBoundary(a,b),true);
});
