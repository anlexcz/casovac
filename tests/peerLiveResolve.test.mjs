import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDutyLive} from '../src/peerLiveResolve.ts';
const now=Date.now();
const feature=(id,line,car,age=5)=>({properties:{trip:{gtfs:{trip_id:id,route_short_name:line},
 vehicle_registration_number:car},last_position:{
 state_position:'on_track',origin_timestamp:new Date(now-age*1000).toISOString()}}});
const candidates=[
 {tripId:'5-trip',line:'5',startSeconds:36000,blockId:'block-42'},
 {tripId:'6-trip',line:'6',startSeconds:38000,blockId:'block-42'}
];
test('successor LIVE can be used even when original trip was never observed, but is provisional',()=>{
 const res=selectDutyLive({originalTripId:'5-trip',candidates,
  features:[feature('6-trip','6','9272')],now});
 assert.equal(res.tripId,'6-trip');
 assert.equal(res.confidence,'provisional');
});
test('recorded original car confirms successor identity while a different car is rejected',()=>{
 assert.equal(selectDutyLive({originalTripId:'5-trip',candidates,
  features:[feature('6-trip','6','9272')],now,anchor:'9272'}).confidence,'anchored');
 const rejected=selectDutyLive({originalTripId:'5-trip',candidates,
  features:[feature('6-trip','6','9300')],now,anchor:'9272'});
 assert.equal(rejected.feature,null);
 assert.equal(rejected.reason,'vehicle-mismatch');
});
test('expired or ambiguous exact-trip observations never become LIVE',()=>{
 assert.equal(selectDutyLive({originalTripId:'5-trip',candidates,
  features:[feature('6-trip','6','9272',120)],now}).reason,'stale');
 assert.equal(selectDutyLive({originalTripId:'5-trip',candidates,
  features:[feature('6-trip','6','9272'),feature('6-trip','6','9341')],now}).reason,'ambiguous');
});
test('matching the wrong line cannot substitute for an exact successor trip',()=>{
 const v=selectDutyLive({originalTripId:'5-trip',candidates,
  features:[feature('6-trip','5','9272')],now});
 assert.equal(v.feature,null);
});
