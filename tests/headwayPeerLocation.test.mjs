import test from 'node:test';
import assert from 'node:assert/strict';
import {plannedPeerLocation,livePeerLocation,plannedPeerStopName,livePeerStopName,serviceSeconds} from '../src/headwayPeerLocation.ts';
import {estimatedPeerGap} from '../src/plannedLiveHeadways.ts';
const day='2026-11-08';
const now=Date.parse('2026-11-08T13:12:00Z'); // 14:12 Prague
const stops=[
 {id:'A',name:'Hlubočepy',sequence:1,arrival:'14:08:00',departure:'14:09:00'},
 {id:'B',name:'Geologická',sequence:2,arrival:'14:11:00',departure:'14:11:30'},
 {id:'C',name:'K Barrandovu',sequence:3,arrival:'14:13:00',departure:'14:13:30'}
];
test('timetable location says between named stops, never claims LIVE',()=>{
 const location=plannedPeerLocation(stops,day,now);
 assert.deepEqual(location,{title:'Podle JŘ mezi zastávkami',
  detail:'Geologická → K Barrandovu'});
});
test('timetable position reports a planned stop dwell and scheduled end',()=>{
 assert.deepEqual(plannedPeerLocation(stops,day,Date.parse('2026-11-08T13:11:15Z')),
  {title:'Podle JŘ: Geologická',detail:'Plánovaný pobyt v zastávce'});
 assert.match(plannedPeerLocation(stops,day,Date.parse('2026-11-08T13:15:00Z')).title,/skončila/);
});
test('GTFS 24:xx is resolved on the preceding Prague service day',()=>{
 const overnight=[{...stops[0],arrival:'24:10:00',departure:'24:11:00'},
  {...stops[1],arrival:'24:15:00',departure:'24:16:00'}];
 const at=Date.parse('2026-11-08T23:13:00Z'); // 00:13 on Nov 9 Prague
 assert.equal(serviceSeconds(day,at),24*3600+13*60);
 assert.deepEqual(plannedPeerLocation(overnight,day,at),
  {title:'Podle JŘ mezi zastávkami',detail:'Hlubočepy → Geologická'});
});
test('refuses missing or invalid schedule data rather than guessing',()=>{
 assert.equal(plannedPeerLocation(null,day,now),null);
 assert.equal(plannedPeerLocation(stops,'bad',now),null);
 assert.equal(plannedPeerLocation([{...stops[0],arrival:'invalid'}],day,now),null);
});
const f=(state,lastSeq,nextSeq)=>({
 properties:{last_position:{state_position:state,last_stop:{sequence:lastSeq},
  next_stop:{sequence:nextSeq}}}
});
test('LIVE stop detail uses exact GTFS stop sequence for at_stop',()=>{
 assert.deepEqual(livePeerLocation(f('at_stop',2,3),stops),
  {title:'Stojí v zastávce Geologická',detail:'Následuje K Barrandovu'});
});
test('LIVE track detail distinguishes next and last stops',()=>{
 assert.deepEqual(livePeerLocation(f('on_track',2,3),stops),
  {title:'Jede k zastávce K Barrandovu',detail:'Poslední zastávka Geologická'});
 assert.equal(livePeerLocation(f('on_track',30,40),stops),null);
});
const own={properties:{trip:{gtfs:{trip_id:'mine',route_short_name:'5'},
 vehicle_registration_number:'9272'},last_position:{state_position:'on_track',
 origin_timestamp:new Date(now-10000).toISOString(),delay:{actual:120}}}};
const peer={tripId:'other',line:'5',order:'',scheduledGap:300,
 departureSeconds:14*3600+10*60,referenceStopId:'A'};
test('without peer LIVE, estimate is adjusted by verified own delay only',()=>{
 assert.equal(estimatedPeerGap({planned:peer,side:'ahead',selected:own,now}),420);
 assert.equal(estimatedPeerGap({planned:peer,side:'behind',selected:own,now}),180);
});
test('without own trustworthy delay, use plain timetable; keep nonnegative gaps',()=>{
 assert.equal(estimatedPeerGap({planned:peer,side:'ahead',selected:null,now}),300);
 const stale=structuredClone(own);
 stale.properties.last_position.origin_timestamp=new Date(now-150000).toISOString();
 assert.equal(estimatedPeerGap({planned:peer,side:'ahead',selected:stale,now}),300);
 const late=structuredClone(own);late.properties.last_position.delay.actual=500;
 assert.equal(estimatedPeerGap({planned:peer,side:'behind',selected:late,now}),0);
 assert.equal(estimatedPeerGap({planned:null,side:'ahead',selected:own,now}),null);
});

test('compact JŘ shows the exact stop during a planned dwell',()=>{
 assert.equal(plannedPeerStopName(stops,day,Date.parse('2026-11-08T13:11:15Z')),'Geologická');
});
test('compact JŘ shows last departed stop between successive stop times',()=>{
 assert.equal(plannedPeerStopName(stops,day,now),'Geologická');
 assert.equal(plannedPeerStopName(stops,day,Date.parse('2026-11-08T13:10:00Z')),'Hlubočepy');
});
test('compact JŘ chooses first before departure, last after arrival, and handles 24:xx',()=>{
 assert.equal(plannedPeerStopName(stops,day,Date.parse('2026-11-08T12:00:00Z')),'Hlubočepy');
 assert.equal(plannedPeerStopName(stops,day,Date.parse('2026-11-08T13:20:00Z')),'K Barrandovu');
 const night=[{...stops[0],arrival:'24:10:00',departure:'24:11:00'},
  {...stops[1],arrival:'24:15:00',departure:'24:16:00'}];
 assert.equal(plannedPeerStopName(night,day,Date.parse('2026-11-08T23:13:00Z')),'Hlubočepy');
});
test('compact JŘ never invents a stop when data or chronology are invalid',()=>{
 assert.equal(plannedPeerStopName(null,day,now),null);
 assert.equal(plannedPeerStopName(stops,'invalid',now),null);
 assert.equal(plannedPeerStopName([{...stops[0],arrival:'oops'}],day,now),null);
 assert.equal(plannedPeerStopName([stops[1],stops[0]],day,now),null);
});
test('compact LIVE returns last verified stop and does not replace it with next stop',()=>{
 assert.equal(livePeerStopName(f('on_track',2,3),stops),'Geologická');
 assert.equal(livePeerStopName(f('at_stop',2,3),stops),'Geologická');
 assert.equal(livePeerStopName(f('on_track',40,3),stops),null);
});
