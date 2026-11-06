import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateLineHeadways,formatHeadway} from '../src/lineHeadways.ts';

const now=Date.parse('2026-11-06T14:54:00+01:00');
const stops=[
 ['A','14:50:00'],['B','14:52:00'],['C','14:54:00'],
 ['D','14:56:00'],['E','14:58:00'],['F','15:00:00']
].map(([id,t],i)=>({id,name:id,arrival:t,departure:t,sequence:i+1,lat:null,lon:null}));
const f=(tripId,car,nextId,eta,delay=0,headsign='Nákladové nádraží Žižkov',state='on_track',origin=now)=>({
 properties:{
  trip:{gtfs:{route_short_name:'9',trip_id:tripId,trip_headsign:headsign},
   sequence_id:Number(tripId.split('_')[1]),vehicle_registration_number:car},
  last_position:{state_position:state,origin_timestamp:new Date(origin).toISOString(),
   next_stop:{id:nextId,arrival_time:new Date(eta).toISOString()},
   delay:{actual:delay}}
 }
});
const me=f('9_23',9383,'C',now+10000);
const ahead=f('9_22',9380,'E',now+10000);
const behind=f('9_24',9384,'A',now+10000);
test('projects two neighbouring positions onto the same stop',()=>{
 const result=calculateLineHeadways({selected:me,features:[me,ahead,behind],stops,now});
 assert.equal(result.aheadSeconds,240);
 assert.equal(result.behindSeconds,240);
 assert.equal(result.matched,2);
});
test('shows gap as mm:ss, including unavailable states',()=>{
 assert.equal(formatHeadway(275),'04:35');
 assert.equal(formatHeadway(null),'—');
});
test('accepts delay in seconds and not line position in metres',()=>{
 const laterAhead=f('9_22',9380,'E',now+10000,30);
 const result=calculateLineHeadways({selected:me,features:[me,laterAhead],stops,now});
 assert.equal(result.aheadSeconds,210);
});
test('rejects opposite direction, stale positions and untracked trips',()=>{
 const opposite=f('9_22',9380,'E',now+10000,0,'Sídliště Řepy');
 const stale=f('9_24',9384,'A',now+10000,0,'Nákladové nádraží Žižkov','on_track',now-120000);
 const prepared=f('9_21',9382,'D',now+10000,0,'Nákladové nádraží Žižkov','before_track');
 const result=calculateLineHeadways({selected:me,features:[me,opposite,stale,prepared],stops,now});
 assert.equal(result.matched,0);
 assert.equal(result.aheadSeconds,null);
 assert.equal(result.behindSeconds,null);
});
test('does not compare trips with stop IDs outside the shared route',()=>{
 const unrelated=f('9_20',9380,'OTHER',now+10000);
 const result=calculateLineHeadways({selected:me,features:[me,unrelated],stops,now});
 assert.equal(result.matched,0);
});
test('avoids fabricated one-second granularity without delays',()=>{
 const missing=f('9_22',9380,'E',now+10000);
 missing.properties.last_position.delay.actual=null;
 const result=calculateLineHeadways({selected:me,features:[me,missing],stops,now});
 assert.equal(result.aheadSeconds,null);
});
test('refuses ambiguous repeated stop ID in current schedule',()=>{
 const repeated=[...stops,{...stops[2],sequence:7}];
 assert.equal(calculateLineHeadways({selected:me,features:[me,ahead],stops:repeated,now}).matched,0);
});
