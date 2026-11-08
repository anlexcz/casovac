import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlannedLiveHeadways} from '../src/plannedLiveHeadways.ts';

const now=Date.now();
const feature=(tripId,line,car,delay,options={})=>({
 properties:{
  trip:{gtfs:{trip_id:tripId,route_short_name:line},
   sequence_id:options.order??'5',vehicle_registration_number:car},
  last_position:{
   state_position:options.state??'on_track',
   origin_timestamp:new Date(now-(options.age??10)*1000).toISOString(),
   delay:{actual:delay}
  }
 }
});
const mine=feature('mine','9','9010',30,{order:'10'});
const ahead=feature('before','9','9011',10,{order:'9'});
const behind=feature('after','9','9012',60,{order:'11'});
const different=feature('closer-but-wrong','9','9013',0,{order:'8'});
const peer=(tripId,line,departureSeconds,gap)=>({
 tripId,line,order:'',departureSeconds,scheduledGap:gap,referenceStopId:'A'
});
const plan={
 ahead:peer('before','9',500,240),
 behind:peer('after','9',1000,300),
 status:'ready',reason:'OK',considered:2,referenceStopId:'A'
};
const run=(features=[different,ahead,behind],selected=mine,planned=plan)=>
 resolvePlannedLiveHeadways({planned,selected,features,now});
test('matches exact planned trip regardless of nearer or differently delayed live trip',()=>{
 const result=run();
 assert.deepEqual(result.ahead,{seconds:260,order:'9'});
 assert.deepEqual(result.behind,{seconds:330,order:'11'});
});
test('planned ahead/behind identity cannot be inverted by delayed vehicles',()=>{
 const result=run([feature('before','9','9011',400),feature('after','9','9012',-400)]);
 assert.equal(result.ahead.seconds,0);
 assert.equal(result.behind.seconds,0);
});
test('unavailable peer telemetry preserves no LIVE rather than treating unknown delay as zero',()=>{
 assert.equal(run([feature('before','9','9011',null)]).ahead,null);
 assert.equal(run([feature('before','9','9011',undefined)]).ahead,null);
 assert.equal(run([feature('before','9','9011',10,{age:120})]).ahead,null);
 assert.equal(run([feature('before','9','9011',10,{state:'before_track'})]).ahead,null);
});
test('requires fresh own position and actual delay',()=>{
 assert.deepEqual(run([ahead,behind],feature('mine','9','9010',null)),{ahead:null,behind:null});
 assert.deepEqual(run([ahead,behind],feature('mine','9','9010',30,{age:130})),{ahead:null,behind:null});
});
test('rejects wrong route, shared vehicle and duplicate exact trip identity',()=>{
 assert.equal(run([feature('before','10','9011',10)]).ahead,null);
 assert.equal(run([feature('before','9','9010',10)]).ahead,null);
 assert.equal(run([ahead,{...ahead}]).ahead,null);
});
test('cross-route planned peer is only matched with exact validated GTFS trip',()=>{
 const crossPlan={...plan,ahead:peer('cross','10',500,240)};
 const cross=feature('cross','10','9222',15,{order:'6'});
 assert.deepEqual(run([cross],mine,crossPlan).ahead,{seconds:255,order:'6'});
 assert.equal(run([feature('cross-other','10','9222',15)],mine,crossPlan).ahead,null);
});
test('unknown and unavailable PLAN never falls back to guessed live peers',()=>{
 assert.deepEqual(run([ahead,behind],mine,{...plan,status:'unavailable'}),{ahead:null,behind:null});
 assert.deepEqual(run([ahead,behind],null),{ahead:null,behind:null});
});
