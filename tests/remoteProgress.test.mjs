import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRemoteProgress} from '../src/remoteProgress.ts';

const now=Date.parse('2026-11-06T10:00:50Z');
const stops=[
 {id:'A',name:'A',sequence:1,arrival:'10:00:00',departure:'10:00:00',lat:null,lon:null},
 {id:'B',name:'B',sequence:2,arrival:'10:01:00',departure:'10:01:00',lat:null,lon:null},
 {id:'C',name:'C',sequence:3,arrival:'10:02:00',departure:'10:02:00',lat:null,lon:null}
];
const memory=()=>({tripId:'',index:null,sourceTimestamp:null});
function run(overrides={},saved=memory()){
 const remote={
  mode:'remote',status:'confirmed',index:0,sourceTimestamp:now-42000,sourceAge:42,apiAge:5,
  vehicleState:'at_stop',previousIndex:0,nextIndex:1,reason:'at stop',
  ...overrides.remote
 };
 return calculateRemoteProgress({
  tripId:'test',stops,vehicle:null,now,terminalWaiting:false,...overrides,remote
 },saved);
}
test('predicts departure on a short segment from aged at_stop observation',()=>{
 const result=run();
 assert.equal(result.index,1);
 assert.equal(result.predicted,true);
 assert.equal(result.threshold,36);
});
test('does not leave a stop before sufficient observation age',()=>{
 const result=run({remote:{sourceTimestamp:now-20000,sourceAge:20}});
 assert.equal(result.index,0);
 assert.equal(result.predicted,false);
});
test('does not predict from stale or off-route observations',()=>{
 for(const remote of [{apiAge:60},{sourceAge:120},{status:'off-route'},{status:'stale'}]){
  const result=run({remote});
  assert.equal(result.predicted,false);
  assert.equal(result.index,0);
 }
});
test('never advances while waiting at a terminal',()=>{
 const result=run({terminalWaiting:true});
 assert.equal(result.index,0);
 assert.equal(result.predicted,false);
});
test('requires the reported following stop to be the direct successor',()=>{
 const result=run({remote:{nextIndex:2}});
 assert.equal(result.index,0);
 assert.equal(result.predicted,false);
});
test('holds confirmed estimate against the same earlier stop report',()=>{
 const saved=memory();
 assert.equal(run({},saved).index,1);
 const second=run({remote:{sourceTimestamp:now-20000,sourceAge:20}},saved);
 assert.equal(second.index,1);
 assert.equal(second.predicted,false);
});
test('resets monotonic estimate when the trip changes',()=>{
 const saved=memory();
 run({},saved);
 const next=calculateRemoteProgress({
  tripId:'different',stops,vehicle:null,now,terminalWaiting:false,
  remote:{mode:'remote',status:'confirmed',index:0,sourceTimestamp:now-10000,
   sourceAge:10,apiAge:5,vehicleState:'at_stop',previousIndex:0,nextIndex:1,reason:'at stop'}
 },saved);
 assert.equal(next.index,0);
 assert.equal(saved.tripId,'different');
});
