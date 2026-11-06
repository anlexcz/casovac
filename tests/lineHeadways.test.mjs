import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateLineHeadways,formatHeadway,sharedReference,headwayEligiblePeers} from '../src/lineHeadways.ts';

const now=Date.parse('2026-11-06T14:54:00+01:00');
const stops=[
 ['A','14:50:00'],['B','14:52:00'],['C','14:54:00'],
 ['D','14:56:00'],['E','14:58:00'],['F','15:00:00']
].map(([id,time],i)=>({id,name:id,arrival:time,departure:time,sequence:i+1,lat:null,lon:null}));
const f=(tripId,car,nextId,eta,delay=0,headsign='Nákladové nádraží Žižkov',state='on_track',origin=now)=>({
 properties:{trip:{gtfs:{route_short_name:'9',trip_id:tripId,trip_headsign:headsign},
  sequence_id:Number(tripId.split('_')[1]),vehicle_registration_number:car},
  last_position:{state_position:state,origin_timestamp:new Date(origin).toISOString(),
   next_stop:{id:nextId,arrival_time:new Date(eta).toISOString()},delay:{actual:delay}}}
});
const me=f('9_23',9383,'C',now+10000);
const ahead=f('9_22',9380,'E',now+10000);
const behind=f('9_24',9384,'A',now+10000);
const peerStops=new Map([['9_22',stops],['9_24',stops]]);
const run=(others,overrides={})=>calculateLineHeadways({
 selected:me,features:[me,...others],stops,peerStops,now,...overrides
});
test('projects nearby trips with different next stops onto a shared reference point',()=>{
 const r=run([ahead,behind]);
 assert.equal(r.aheadSeconds,240);
 assert.equal(r.behindSeconds,240);
 assert.equal(r.matched,2);
});
test('uses same next stop for both vehicles when one is already ahead in time',()=>{
 const p=f('9_22',9380,'C',now-270000);
 const r=run([p]);
 assert.equal(r.aheadSeconds,280);
 assert.equal(r.behindSeconds,null);
});
test('different headsign does not invalidate same-direction short turn on shared track',()=>{
 const shortTurn=f('9_22',9380,'E',now+10000,0,'Vozovna Motol');
 assert.equal(run([shortTurn]).aheadSeconds,240);
});
test('accepts a separate trip schedule with slightly different running times',()=>{
 const special=[...stops];special[4]={...stops[4],arrival:'14:59:00',departure:'14:59:00'};
 const r=run([ahead],{peerStops:new Map([['9_22',special]])});
 assert.equal(r.aheadSeconds,300);
});
test('includes valid delay in seconds',()=>{
 const delayed=f('9_22',9380,'E',now+10000,30);
 assert.equal(run([delayed]).aheadSeconds,210);
});
test('uses latest stop delay when actual delay is missing',()=>{
 const alternate=f('9_22',9380,'E',now+10000);
 alternate.properties.last_position.delay.actual=null;
 alternate.properties.last_position.delay.last_stop_arrival=12;
 assert.equal(run([alternate]).aheadSeconds,228);
});
test('refuses to invent an ETA without any delay evidence',()=>{
 const missing=f('9_22',9380,'E',now+10000);
 missing.properties.last_position.delay.actual=null;
 assert.equal(run([missing]).matched,0);
});
test('rejects stale positions and inactive trips',()=>{
 const stale=f('9_24',9384,'A',now+10000,0,'Nákladové nádraží Žižkov','on_track',now-120000);
 const prepared=f('9_22',9380,'E',now+10000,0,'Nákladové nádraží Žižkov','before_track');
 assert.equal(run([stale,prepared]).matched,0);
});
test('rejects opposite-direction route and trips on another line',()=>{
 const reversed=[...stops].reverse().map((s,i)=>({...s,sequence:i+1}));
 const r=run([ahead],{peerStops:new Map([['9_22',reversed]])});
 assert.equal(r.matched,0);
 const different=f('9_22',9380,'E',now+10000);
 different.properties.trip.gtfs.route_short_name='10';
 assert.equal(run([different]).matched,0);
});
test('stops of another branch are not silently matched',()=>{
 const unrelated=f('9_22',9380,'OTHER',now+10000);
 assert.equal(run([unrelated]).matched,0);
});
test('requires two ordered common stops near both vehicles',()=>{
 const sparse=[stops[4],{...stops[0],id:'OTHER'}].map((s,i)=>({...s,sequence:i+1}));
 assert.equal(sharedReference(stops,sparse,'C','E'),null);
});
test('ambiguous repeating stop IDs are not used as a reference',()=>{
 const repeated=[...stops,{...stops[2],sequence:7}];
 assert.equal(run([ahead],{stops:repeated}).matched,0);
});
test('filter does not request details for inactive, remote or stale peers',()=>{
 const stale=f('9_25',9385,'D',now+10000,0,'Nákladové nádraží Žižkov','on_track',now-125000);
 assert.deepEqual(headwayEligiblePeers(me,[me,ahead,behind,stale],stops,now).map(p=>p.properties.trip.gtfs.trip_id),['9_22','9_24']);
});
test('formatting remains compact with missing values',()=>{
 assert.equal(formatHeadway(275),'04:35');
 assert.equal(formatHeadway(null),'—');
});
