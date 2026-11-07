import test from 'node:test';
import assert from 'node:assert/strict';
import {decideCoreDuty,filterCoreFeatures} from '../src/coreDutySelection.ts';
import {serviceFromFeature,serviceKey} from '../src/trackedService.ts';

const now=Date.parse('2026-11-07T13:45:00+01:00');
const f=(line,origin,order,car,state='on_track',offset=0,id='trip')=>({
 properties:{trip:{
  gtfs:{route_short_name:line,trip_id:id},
  origin_route_name:origin,sequence_id:order,vehicle_registration_number:car,
  start_timestamp:'2026-11-07T13:40:00+01:00'
 },last_position:{state_position:state,
  origin_timestamp:new Date(now+offset).toISOString()}}
});
const core=serviceFromFeature(f('2','91',71,8266), '2026-11-07');
test('route 2/71 hands to live 91/71 by core rather than registration',()=>{
 const decision=decideCoreDuty([
  f('2','91',71,8266,'after_track',-60000,'old'),
  f('91','91',71,8266,'on_track',-5000,'new'),
  f('91','91',72,8261,'on_track',-1000,'wrong')
 ],core,now);
 assert.equal(decision.reason,'active');
 assert.deepEqual([decision.candidate.route,decision.candidate.order,decision.candidate.tripId],
  ['91','71','new']);
 assert.equal(serviceKey(core),'2026-11-07|91/71');
});
test('car replacement on a different line is permitted, car is not identity',()=>{
 const decision=decideCoreDuty([f('91','91',71,8270,'at_stop',-2000,'replacement')],core,now);
 assert.equal(decision.candidate?.vehicle,'8270');
 assert.equal(decision.candidate?.route,'91');
});
test('two equally fresh cars claiming the same duty are ambiguous',()=>{
 const decision=decideCoreDuty([
  f('2','91',71,8266,'on_track',-5000,'one'),
  f('91','91',71,8270,'on_track',-3000,'two')
 ],core,now);
 assert.equal(decision.reason,'ambiguous');
 assert.equal(decision.candidate,null);
});
test('strong fresh telemetry wins only when competing vehicle is clearly older',()=>{
 const decision=decideCoreDuty([
  f('2','91',71,8266,'on_track',-62000,'old'),
  f('91','91',71,8270,'on_track',-3000,'new')
 ],core,now);
 assert.equal(decision.reason,'active');
 assert.equal(decision.candidate?.vehicle,'8270');
});
test('do not jump to a different route based on prepared or ended trips',()=>{
 const decision=decideCoreDuty([
  f('91','91',71,8266,'before_track',-1000,'next'),
  f('2','91',71,8266,'after_track',-1000,'old')
 ],core,now);
 assert.equal(decision.reason,'no-live');
 assert.equal(decision.candidate,null);
});
test('stale candidate, wrong origin or wrong order never switch duty',()=>{
 assert.equal(decideCoreDuty([f('91','91',71,8266,'on_track',-120000)],core,now).reason,'stale');
 assert.equal(decideCoreDuty([f('91','92',71,8266)],core,now).reason,'no-match');
 assert.equal(decideCoreDuty([f('91','91',72,8266)],core,now).reason,'no-match');
 assert.equal(decideCoreDuty([f('91',null,71,8266)],core,now).reason,'no-match');
});
test('current-route list excludes foreign origin even with matching current line/order',()=>{
 const accepted=f('2','91',71,8266,'on_track',-5000,'good');
 const foreign=f('2','92',71,8267,'on_track',-1000,'wrong');
 assert.deepEqual(filterCoreFeatures([accepted,foreign],core),[accepted]);
 assert.deepEqual(filterCoreFeatures([accepted,foreign],null),[accepted,foreign]);
});
test('same physical car reporting other duty is never a match',()=>{
 const wrong=f('9','9',13,8266,'on_track',-1000,'other');
 assert.equal(decideCoreDuty([wrong],core,now).reason,'no-match');
});
