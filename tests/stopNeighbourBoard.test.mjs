import test from 'node:test';
import assert from 'node:assert/strict';
import {departureBoardUrl,parseNeighbourBoard} from '../src/stopNeighbourBoard.ts';
import {DEFAULT_NEIGHBOUR_SETTINGS as settings} from '../src/stopNeighbours.ts';
const stop=(id,time,sequence)=>({id,name:'Společná hrana',sequence,arrival:time,departure:time,lat:null,lon:null});
const ownStops=[stop('P','10:27:00',1),stop('A','10:30:00',2),stop('N','10:32:00',3)];
const departure=(id,line,scheduled,stopId='A',delay=60)=>({
 trip:{id,is_canceled:false},route:{short_name:line,type:0},stop:{id:stopId},
 arrival_timestamp:{scheduled},departure_timestamp:{scheduled},
 delay:{is_available:delay!==null,seconds:delay}
});
const args={stop:ownStops[1],ownTripId:'own',ownStops,ownIndex:1,
 ownDelay:60,settings,distance:0,features:[]};
test('departure board query requests an exact platform, all lines and scheduled order',()=>{
 const url=new URL(departureBoardUrl(['A']));
 assert.deepEqual(url.searchParams.getAll('ids[]'),['A']);
 assert.equal(url.searchParams.get('filter'),'none');
 assert.equal(url.searchParams.get('order'),'timetable');
 assert.equal(url.searchParams.get('mode'),'mixed');
});
test('a single board yields mixed-mode services across unrelated lines without individual GTFS lookups',()=>{
 const bus=departure('bus','125','2026-11-07T09:29:00Z');
 bus.route.type=3;
 const rows=[
  bus,
  departure('before','23','2026-11-07T09:29:00Z'),
  departure('after','22','2026-11-07T09:32:00Z'),
  departure('wrong-platform','17','2026-11-07T09:31:00Z','B'),
  departure('own','9','2026-11-07T09:30:00Z')
 ];
 const result=parseNeighbourBoard({...args,board:{departures:rows}});
 assert.deepEqual(result.rows.map(x=>x.line),['125','23','22']);
 assert.deepEqual(result.rows.map(x=>x.relative),['before','before','after']);
 assert.deepEqual(result.rows.map(x=>x.scheduled.slice(0,5)),['10:29','10:29','10:32']);
 assert.equal(result.rows[0].order,'?');
 assert.equal(result.rows[0].vehicle,'');
});
test('missing live delay remains unknown and not a fabricated on-time vehicle',()=>{
 const result=parseNeighbourBoard({...args,board:{departures:[
  departure('peer','7','2026-11-07T09:31:00Z','A',null)
 ]}});
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].delay,null);
});
test('incoming branch is not inferred until the individual trip is independently verified',()=>{
 const board={departures:[departure('peer','7','2026-11-07T09:31:00Z')]};
 assert.equal(parseNeighbourBoard({...args,board}).significant,false);
 const peerStops=[{...stop('OTHER','10:29:00',1),name:'Jiná příjezdová větev'},stop('A','10:31:00',2),stop('N','10:32:00',3)];
 assert.equal(parseNeighbourBoard({...args,board,candidateStops:new Map([['peer',peerStops]])}).significant,true);
});
test('cancelled trips and unsupported modes are excluded while buses are retained',()=>{
 const bus=departure('bus','125','2026-11-07T09:31:00Z');
 bus.route.type=3;
 const cancelled=departure('cancelled','7','2026-11-07T09:32:00Z');
 cancelled.trip.is_canceled=true;
 const train=departure('train','S1','2026-11-07T09:31:00Z');
 train.route.type=2;
 const result=parseNeighbourBoard({...args,board:{departures:[bus,train,cancelled]}});
 assert.deepEqual(result.rows.map(x=>x.line),['125']);
});

test('departure at divergence remains visible manually, but never triggers either automatic mode',()=>{
 const own=[
  {...stop('P','10:27:00',1),name:'Výtoň'},
  {...stop('A','10:30:00',2),name:'Palackého náměstí'},
  {...stop('N','10:32:00',3),name:'Zborovská'}
 ];
 const diverging=[
  {...stop('','10:27:00',1),name:'Výtoň'},
  {...stop('','10:31:00',2),name:'Palackého náměstí'},
  {...stop('','10:33:00',3),name:'Jiráskovo náměstí'}
 ];
 const result=parseNeighbourBoard({...args,ownStops:own,stop:own[1],
  board:{departures:[departure('peer','3','2026-11-07T09:31:00Z')]},
  candidateStops:new Map([['peer',diverging]])});
 assert.equal(result.rows.length,1);
 assert.equal(result.significant,false);
 assert.equal(result.sharedOutgoing,false);
});
test('continuation can open all-mode, but important-mode requires an incoming join',()=>{
 const own=[
  {...stop('P','10:27:00',1),name:'Výtoň'},
  {...stop('A','10:30:00',2),name:'Palackého náměstí'},
  {...stop('N','10:32:00',3),name:'Zborovská'}
 ];
 const same=[
  {...stop('','10:27:00',1),name:'Výtoň'},
  {...stop('','10:31:00',2),name:'Palackého náměstí'},
  {...stop('','10:33:00',3),name:'Zborovská'}
 ];
 const result=parseNeighbourBoard({...args,ownStops:own,stop:own[1],
  board:{departures:[departure('peer','3','2026-11-07T09:31:00Z')]},
  candidateStops:new Map([['peer',same]])});
 assert.equal(result.significant,false);
 assert.equal(result.sharedOutgoing,true);
});

test('same physical edge with different GTFS stop_id admits bus and trolley only when verified',()=>{
 const bus=departure('bus','140','2026-11-07T09:31:00Z','BUS');
 bus.route.type=3;
 const trolley=departure('trolley','58','2026-11-07T09:31:30Z','TROLLEY');
 trolley.route.type=11;
 const unknown=departure('unknown','120','2026-11-07T09:31:00Z','OTHER');
 unknown.route.type=3;
 const rows=[bus,trolley,unknown];
 assert.deepEqual(parseNeighbourBoard({...args,board:{departures:rows}}).rows,[]);
 const result=parseNeighbourBoard({...args,board:{departures:rows,physicalStopIds:['A','BUS','TROLLEY']}});
 assert.deepEqual(result.rows.map(x=>x.line),['140','58']);
 assert.equal(result.significant,true);
});
