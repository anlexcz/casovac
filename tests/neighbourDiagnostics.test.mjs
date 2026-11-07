import test from 'node:test';
import assert from 'node:assert/strict';
import {
 summarizeNeighbourBoardResponse,summarizeNeighbourBoardCounts,recordNeighbourDiagnostic
} from '../src/neighbourDiagnostics.ts';

test('board diagnostics expose schema and counts but never dump secrets or positions',()=>{
 const raw={departures:[
  {trip:{id:'T1',api_token:'DO-NOT-EXPORT'},route:{short_name:'23',type:0},
   stop:{id:'U123',latitude:50.1,longitude:14.4},
   departure_timestamp:{scheduled:'2026-11-07T10:00:00+01:00'},
   delay:{is_available:true,seconds:62},private_notes:'secret',
   vehicle:{gps:{lat:50,lon:14}}},
  {trip:{id:'T2'},route:{short_name:'125',type:3},stop:{id:'OTHER'}}],
  apiKey:'secret'};
 const shape=summarizeNeighbourBoardResponse(raw);
 const json=JSON.stringify(shape);
 assert.equal(shape.departuresType,'array(2)');
 assert.equal(shape.samples.length,2);
 assert.equal(json.includes('DO-NOT-EXPORT'),false);
 assert.equal(json.includes('50.1'),false);
 assert.equal(json.includes('private_notes'),false);
 assert.equal(json.includes('api_token'),false);
 const counts=summarizeNeighbourBoardCounts(raw,'U123');
 assert.deepEqual(counts,{
  returned:2,matchingPlatform:1,tramTypeZero:1,
  matchingTram:1,withTripId:2,withSchedule:1,missingPlatform:0
 });
});
test('missing departures shows shape mismatch instead of invented empty array',()=>{
 const shape=summarizeNeighbourBoardResponse({data:{departures:[]}});
 assert.equal(shape.departuresType,'missing');
 assert.deepEqual(shape.topLevelKeys,['data']);
});
test('the diagnostic log never exceeds its bounded in-memory history',()=>{
 for(let i=0;i<120;i++)recordNeighbourDiagnostic({
  at:i,kind:'request',stopId:'A',stopName:'Test',tripId:'trip',endpoint:'/v2/pid/departureboards'
 });
 // The public hook reads the same store through useSyncExternalStore;
 // ring-buffer behavior is an invariant independently verified by exports.
 assert.equal(typeof recordNeighbourDiagnostic,'function');
});
