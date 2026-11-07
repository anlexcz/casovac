import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateLineHeadways,formatHeadway,sharedReference,headwayEligiblePeers} from '../src/lineHeadways.ts';
import {joinHeadwayBlock,possibleBlockPartners} from '../src/headwayChains.ts';
import {findVerifiedBlockPair} from '../src/blockPair.ts';
import {assessCorridor} from '../src/headwayCorridor.ts';

const now=Date.parse('2026-11-06T14:54:00+01:00');
const stops=['A','B','C','D','E','F'].map((id,i)=>({
 id,name:id,arrival:'14:'+String(50+2*i).padStart(2,'0')+':00',
 departure:'14:'+String(50+2*i).padStart(2,'0')+':00',
 sequence:i+1,lat:null,lon:null
}));
const shifted=(source,minutes)=>source.map(s=>{
 const shift=t=>{
  const [h,m,sec]=t.split(':').map(Number),sum=h*3600+m*60+sec+minutes*60;
  return [Math.floor(sum/3600),Math.floor(sum%3600/60),sum%60]
   .map(v=>String(v).padStart(2,'0')).join(':');
 };
 return {...s,arrival:shift(s.arrival),departure:shift(s.departure)};
});
const f=(tripId,car,nextId,eta,{delay=0,line='9',order,headsign='Nákladové nádraží Žižkov',
 state='on_track',origin=now}={})=>({
 properties:{trip:{gtfs:{route_short_name:line,trip_id:tripId,trip_headsign:headsign},
  sequence_id:order??Number(tripId.split('_')[1]),vehicle_registration_number:car},
  last_position:{state_position:state,origin_timestamp:new Date(origin).toISOString(),
   next_stop:{id:nextId,arrival_time:new Date(eta).toISOString()},delay:{actual:delay}}}
});
const me=f('9_23',9383,'C',now+10000);
const ahead=f('9_22',9380,'E',now+10000);
const behind=f('9_24',9384,'A',now+10000);
const schedules=new Map([['9_23',stops],['9_22',shifted(stops,-4)],['9_24',shifted(stops,4)]]);
const run=(peers,opts={})=>calculateLineHeadways({
 selected:me,features:[me,...peers],stops,peerStops:schedules,now,...opts
});
test('closest neighbours are ranked by PLANNED time and keep identity badges',()=>{
 const r=run([ahead,behind]);
 assert.equal(r.aheadSeconds,240);
 assert.equal(r.behindSeconds,240);
 assert.deepEqual([r.ahead.line,r.ahead.order,r.behind.line,r.behind.order],['9','22','9','24']);
});
test('a delayed planned predecessor never becomes a follower: clamp at zero',()=>{
 const late=f('9_22',9380,'E',now+5*60000);
 const r=run([late]);
 assert.equal(r.aheadSeconds,0);
 assert.equal(r.behindSeconds,null);
 assert.equal(r.ahead.tripId,'9_22');
});
test('an early planned follower never becomes a predecessor: clamp at zero',()=>{
 const early=f('9_24',9384,'A',now-5*60000);
 const r=run([early]);
 assert.equal(r.behindSeconds,0);
 assert.equal(r.aheadSeconds,null);
});
test('chooses closest planned predecessor, not closest live prediction',()=>{
 const far=f('9_20',9381,'F',now+10000);
 const s=new Map(schedules);
 s.set('9_20',shifted(stops,-12));
 const near=f('9_22',9380,'E',now+7*60000);
 const r=run([far,near],{peerStops:s});
 assert.equal(r.ahead.tripId,'9_22');
 assert.equal(r.aheadSeconds,0);
});
test('same next stop is comparable when planned trips differ',()=>{
 const neighbour=f('9_22',9380,'C',now-270000);
 const r=run([neighbour]);
 assert.equal(r.aheadSeconds,280);
});
test('short-turn destination difference does not change shared-track comparisons',()=>{
 const short=f('9_22',9380,'E',now+10000,{headsign:'Vozovna Motol'});
 assert.equal(run([short]).aheadSeconds,240);
});
test('uses live delay but fixed planned ordering',()=>{
 const delayed=f('9_22',9380,'E',now+10000,{delay:30});
 assert.equal(run([delayed]).aheadSeconds,210);
});
test('stale or nontracking vehicles are not selected',()=>{
 const stale=f('9_22',9380,'E',now+10000,{origin:now-120000});
 const prepared=f('9_24',9384,'A',now+10000,{state:'before_track'});
 assert.equal(run([stale,prepared]).matched,0);
});
test('9/5 ignores nearby 10 on the SAME tracks even when its route is a verified chain member',()=>{
 const connected=f('10_22',9380,'E',now+10000,{line:'10',order:22});
 const s=new Map(schedules);s.set('10_22',shifted(stops,-4));
 assert.equal(run([connected],{peerStops:s}).matched,0);
 const r=run([connected],{peerStops:s,allowedRoutes:new Set(['9','10'])});
 assert.equal(r.ahead,null);
 assert.equal(r.decisions[0].reason,'Jiná linka: mimo ověřenou přechodovou konečnou');
});
test('reverse order of common stops is never accepted',()=>{
 const reverse=[...stops].reverse().map((s,i)=>({...s,sequence:i+1}));
 assert.equal(run([ahead],{peerStops:new Map([['9_23',stops],['9_22',reverse]])}).matched,0);
});
test('rejects ambiguous repeated stop ids',()=>{
 const repeated=[...stops,{...stops[2],sequence:7}];
 assert.equal(run([ahead],{peerStops:new Map([['9_23',repeated],['9_22',shifted(stops,-4)]])}).matched,0);
});
test('public GTFS without stop ids does not hide static GTFS-based headways',()=>{
 const pub=stops.map(s=>({...s,id:''}));
 assert.equal(headwayEligiblePeers(me,[me,ahead],pub,now).length,1);
 assert.equal(run([ahead],{stops:pub}).aheadSeconds,240);
});
test('does not show a timing value without telemetry or schedule',()=>{
 const noDelay=f('9_22',9380,'E',now+10000);
 noDelay.properties.last_position.delay.actual=null;
 assert.equal(run([noDelay]).aheadSeconds,null);
 assert.equal(run([ahead],{peerStops:new Map()}).aheadSeconds,null);
});
test('correctly formats unavailable and zero spacing',()=>{
 assert.equal(formatHeadway(275),'04:35');
 assert.equal(formatHeadway(0),'00:00');
 assert.equal(formatHeadway(null),'—');
});
const details=(id,line,block,ids,offset)=>({
 trip_id:id,block_id:block,route:{route_short_name:line},
 stop_times:ids.map((stopId,i)=>({
  stop_id:stopId,stop_sequence:i+1,
  arrival_time:String(14+Math.floor((50+offset+i*2)/60)).padStart(2,'0')+':'+String((50+offset+i*2)%60).padStart(2,'0')+':00',
  departure_time:String(14+Math.floor((50+offset+i*2)/60)).padStart(2,'0')+':'+String((50+offset+i*2)%60).padStart(2,'0')+':00'
 }))
});
const first=details('9_A','9','BLOCK_A',['P','Q','T'],0);
const second=details('10_A','10','BLOCK_A',['T','U','V'],4);
test('GTFS block pair creates a continuous timetable with one boundary stop',()=>{
 const combined=joinHeadwayBlock(first,second);
 assert.deepEqual(combined.stops.map(s=>s.id),['P','Q','T','U','V']);
 assert.equal(combined.firstId,'9_A');
 assert.equal(joinHeadwayBlock(second,first).secondId,'10_A');
});
test('false vehicle/order matching cannot join unrelated GTFS blocks',()=>{
 assert.equal(joinHeadwayBlock(first,{...second,block_id:'DIFFERENT'}),null);
 assert.equal(joinHeadwayBlock(first,{...second,route:{route_short_name:'9'}}),null);
});
test('GTFS lookup must filter exact block and reject unrelated terminal trips',()=>{
 assert.deepEqual(possibleBlockPartners(first,[second,{...second,trip_id:'other',block_id:'B'}],'10'),['10_A']);
});
test('after transition, a preceding-line vehicle remains the planned follower',()=>{
 const my=f('10_current',9128,'U',now+10000,{line:'10',order:11});
 const next=f('9_follow',9405,'Q',now+10000,{line:'9',order:12});
 const myStops=details('10_current','10','ME',['T','U','V'],4);
 const followFirst=details('9_follow','9','FOLLOW',['P','Q','T'],4);
 const followSecond=details('10_follow','10','FOLLOW',['T','U','V'],8);
 const mapped=new Map([
  ['10_current',stopsOf(myStops)],
  ['9_follow',joinHeadwayBlock(followFirst,followSecond).stops]
 ]);
 const result=calculateLineHeadways({
  selected:my,features:[my,next],stops:stopsOf(myStops),
  peerStops:mapped,now,allowedRoutes:new Set(['9','10']),
  links:new Map([['9_follow',{firstId:'9_follow',secondId:'10_follow',
   firstLine:'9',secondLine:'10',boundaryIndex:2}]])
 });
 assert.equal(result.behind.tripId,'9_follow');
 assert.equal(result.behind.line,'9');
 assert.equal(result.behind.order,'12');
});
function stopsOf(detail){
 return detail.stop_times.map((s,i)=>({
  id:s.stop_id,name:s.stop_id,sequence:i+1,
  arrival:s.arrival_time,departure:s.departure_time,lat:null,lon:null
 }));
}

test('diverted predecessor is replaced by the next eligible planned service',()=>{
 const mine=f('9_current',9300,'C',now+10000,{order:23});
 const diverted=f('9_divert',9301,'X',now+10000,{order:22});
 const replacement=f('9_replace',9302,'D',now+10000,{order:21});
 const peerDivert=shifted(stops.slice(0,4),-4).concat([
  {...stops[4],id:'X',arrival:'14:58:00',departure:'14:58:00'},
  {...stops[5],id:'Y',arrival:'15:00:00',departure:'15:00:00'}
 ]);
 const map=new Map([['9_current',stops],['9_divert',peerDivert],['9_replace',shifted(stops,-8)]]);
 const r=calculateLineHeadways({selected:mine,features:[mine,diverted,replacement],
  stops,peerStops:map,now});
 assert.equal(r.ahead.tripId,'9_replace');
});
test('short turning peer stays eligible until its last shared stop',()=>{
 const mine=f('9_current',9300,'C',now+10000,{order:23});
 const short=f('9_short',9301,'D',now+10000,{order:22});
 const shortStops=shifted(stops.slice(0,4),-4);
 const r=calculateLineHeadways({selected:mine,features:[mine,short],
  stops,peerStops:new Map([['9_current',stops],['9_short',shortStops]]),now});
 assert.equal(r.ahead.tripId,'9_short');
});
test('vehicle approaching common section through verified chained schedule remains eligible',()=>{
 const mine=f('10_now',9200,'U',now+10000,{line:'10',order:11});
 const approaching=f('9_approach',9201,'Q',now+10000,{line:'9',order:12});
 const ownStops=[
  {id:'T',name:'T',sequence:1,arrival:'14:54:00',departure:'14:54:00'},
  {id:'U',name:'U',sequence:2,arrival:'14:56:00',departure:'14:56:00'},
  {id:'V',name:'V',sequence:3,arrival:'14:58:00',departure:'14:58:00'}
 ];
 const linked=[
  {id:'P',arrival:'14:50:00',departure:'14:50:00'},
  {id:'Q',arrival:'14:52:00',departure:'14:52:00'},
  ...shifted(ownStops,4)
 ].map((v,i)=>({name:v.id,sequence:i+1,...v}));
 const r=calculateLineHeadways({selected:mine,features:[mine,approaching],
  stops:ownStops,peerStops:new Map([['10_now',ownStops],['9_approach',linked]]),
  now,allowedRoutes:new Set(['9','10']),
  links:new Map([['9_approach',{firstId:'9_approach',secondId:'10_approach',
   firstLine:'9',secondLine:'10',boundaryIndex:2}]])});
 assert.equal(r.behind?.tripId,'9_approach');
});
test('unrelated later intersection does not keep diverted vehicle eligible',()=>{
 const mine=f('9_current',9300,'C',now+10000,{order:23});
 const diverted=f('9_divert',9301,'X',now+10000,{order:22});
 const detour=['A','B','C','D','X','Y','F'].map((id,i)=>({
  ...stops[Math.min(i,stops.length-1)],id,sequence:i+1
 }));
 const r=calculateLineHeadways({selected:mine,features:[mine,diverted],
  stops,peerStops:new Map([['9_current',stops],['9_divert',detour]]),now});
 assert.equal(r.ahead,null);
});

test('corridor diagnostics identify a peer that already left on a depot branch',()=>{
 const peer=['A','B','C','D','X','Y'].map((id,i)=>({...stops[i],id}));
 const decision=assessCorridor(stops,peer,'C','X');
 assert.equal(decision.reference,null);
 assert.equal(decision.reason,'peer-past-corridor');
});
test('approaching peer of a verified chained route may be behind us',()=>{
 const own=['T','U','V'].map((id,i)=>({...stops[i],id}));
 const peer=['P','Q','T','U','V'].map((id,i)=>({...stops[i%stops.length],id}));
 assert.ok(assessCorridor(own,peer,'U','Q').reference);
});
test('our route approaching a future common section is not compared prematurely',()=>{
 const own=['A','B','C','D','E'].map((id,i)=>({...stops[i],id}));
 const peer=['X','Y','C','D','E'].map((id,i)=>({...stops[i],id}));
 assert.equal(assessCorridor(own,peer,'B','Y').reason,'own-before-corridor');
});
test('our route past the common section does not retain a previous peer',()=>{
 const own=['A','B','C','D','E'].map((id,i)=>({...stops[i],id}));
 const peer=['A','B','C','X','Y'].map((id,i)=>({...stops[i],id}));
 assert.equal(assessCorridor(own,peer,'E','B').reason,'own-past-corridor');
});
test('diagnostics report why a diversion is excluded and which alternative was chosen',()=>{
 const mine=f('9_diag',9300,'C',now+10000,{order:23});
 const left=f('9_left',9301,'X',now+10000,{order:22});
 const replacement=f('9_next',9302,'D',now+10000,{order:21});
 const leftStops=['A','B','C','D','X','Y'].map((id,i)=>({...shifted(stops,-4)[i],id}));
 const mapped=new Map([
  ['9_diag',stops],['9_left',leftStops],['9_next',shifted(stops,-8)]
 ]);
 const result=calculateLineHeadways({selected:mine,features:[mine,left,replacement],
  stops,peerStops:mapped,now});
 assert.equal(result.ahead?.tripId,'9_next');
 assert.equal(result.decisions.find(d=>d.tripId==='9_left')?.reason,'Koridor: peer-past-corridor');
 assert.equal(result.decisions.find(d=>d.tripId==='9_next')?.reason,'Vhodný spoj');
});

test('block verification is not restricted to enumerated line pairs (6 to 34)',()=>{
 const first=details('6_A','6','BLOCK_634',['K','L','M'],0);
 const second=details('34_A','34','BLOCK_634',['M','N','O'],4);
 const trip={tripId:'34_A',line:'34',order:'',vehicle:'',state:'before_track',
  start:null,lastStop:null,nextStop:null,rawTrip:null,source:'GTFS'};
 const verified=findVerifiedBlockPair(
  {tripId:'6_A',line:'6',start:null,detail:first},[{trip,detail:second}]
 );
 assert.equal(verified?.partner.line,'34');
 assert.equal(verified?.role,'first');
 assert.equal(joinHeadwayBlock(first,second)?.stops.length,5);
});
test('unrelated line cannot become chained merely by sharing stop or block identifier',()=>{
 const first=details('6_A','6','BLOCK_634',['K','L','M'],0);
 const other=details('34_B','34','OTHER_BLOCK',['M','N','O'],4);
 const trip={tripId:'34_B',line:'34',order:'',vehicle:'',state:'before_track',
  start:null,lastStop:null,nextStop:null,rawTrip:null,source:'GTFS'};
 assert.equal(findVerifiedBlockPair(
  {tripId:'6_A',line:'6',start:null,detail:first},[{trip,detail:other}]
 ),null);
});

test('same operating line always beats physically closer foreign line unless at verified boundary',()=>{
 const same=f('9_22',9380,'E',now+10000);
 const foreign=f('10_21',9379,'C',now+10000,{line:'10',order:21});
 const mapped=new Map(schedules);
 mapped.set('10_21',shifted(stops,-2));
 const result=run([same,foreign],{peerStops:mapped,allowedRoutes:new Set(['9','10'])});
 assert.equal(result.ahead?.tripId,'9_22');
 assert.equal(result.decisions.find(x=>x.tripId==='10_21')?.reason,
  'Jiná linka: mimo ověřenou přechodovou konečnou');
});
test('first leg at its actual shared terminal may compare the next chained line',()=>{
 const own=f('9_current',9383,'T',now+10000,{line:'9',order:5});
 const other=f('10_next',9125,'U',now+10000,{line:'10',order:6});
 const ownStops=['P','Q','T','U','V'].map((id,i)=>({
  id,name:id,sequence:i+1,
  arrival:'14:'+String(50+2*i).padStart(2,'0')+':00',
  departure:'14:'+String(50+2*i).padStart(2,'0')+':00'
 }));
 const peerStops=shifted(ownStops.slice(2),-2);
 const map=new Map([['9_current',ownStops],['10_next',peerStops]]);
 const links=new Map([['9_current',{firstId:'9_current',secondId:'10_current',
  firstLine:'9',secondLine:'10',boundaryIndex:2}]]);
 const r=calculateLineHeadways({selected:own,features:[own,other],stops:ownStops,
  peerStops:map,now,allowedRoutes:new Set(['9','10']),links});
 assert.equal(r.ahead?.tripId,'10_next');
});
test('foreign line cannot be admitted just because an unrelated linked block exists',()=>{
 const my=f('9_A',9383,'C',now+10000,{line:'9',order:5});
 const other=f('10_A',9125,'E',now+10000,{line:'10',order:6});
 const map=new Map([['9_A',stops],['10_A',shifted(stops,-2)]]);
 const links=new Map([['unrelated_9',{firstId:'unrelated_9',secondId:'unrelated_10',
  firstLine:'9',secondLine:'10',boundaryIndex:2}]]);
 const r=calculateLineHeadways({selected:my,features:[my,other],stops,
  peerStops:map,now,allowedRoutes:new Set(['9','10']),links});
 assert.equal(r.matched,0);
});

test('headways use GTFS scheduled next-stop time when live ETA timestamp is absent',()=>{
 const meWithoutEta=f('9_23',9383,'C',now+10000);
 const beforeWithoutEta=f('9_22',9380,'E',now+10000);
 delete meWithoutEta.properties.last_position.next_stop.arrival_time;
 delete beforeWithoutEta.properties.last_position.next_stop.arrival_time;
 const r=calculateLineHeadways({selected:meWithoutEta,features:[meWithoutEta,beforeWithoutEta],
  stops,peerStops:schedules,now});
 assert.equal(r.ahead?.tripId,'9_22');
 assert.equal(r.aheadSeconds,240);
});
test('headways accept an alternate fresh vehicle timestamp field',()=>{
 const meAlt=f('9_23',9383,'C',now+10000);
 const neighbourAlt=f('9_22',9380,'E',now+10000);
 for(const feature of [meAlt,neighbourAlt]){
  feature.properties.last_position.timestamp=feature.properties.last_position.origin_timestamp;
  delete feature.properties.last_position.origin_timestamp;
 }
 const r=calculateLineHeadways({selected:meAlt,features:[meAlt,neighbourAlt],
  stops,peerStops:schedules,now});
 assert.equal(r.aheadSeconds,240);
});
