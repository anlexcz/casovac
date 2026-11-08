import test from 'node:test';
import assert from 'node:assert/strict';
import {findBoardContinuations} from '../src/boardBlockContinuity.ts';
import {parseNeighbourBoard} from '../src/stopNeighbourBoard.ts';
import {DEFAULT_NEIGHBOUR_SETTINGS} from '../src/stopNeighbours.ts';

const date='2026-11-08';
const stop=(id,a,d,n)=>({id,name:id,sequence:n,arrival:a,departure:d,
 lat:50,lon:14,platformCode:'A'});
const inside=[stop('A','18:20:00','18:20:00',1),
 stop('P','19:00:00','19:00:00',2)];
const outside=[stop('P','19:00:00','19:00:00',1),
 stop('B','19:20:00','19:20:00',2)];
const details={
 incoming:{id:'incoming',date,routeId:'R5',blockId:'B',stopTimes:[[ 'A',66000,66000,1],['P',68400,68400,2]]},
 outgoing:{id:'outgoing',date,routeId:'R6',blockId:'B',stopTimes:[['P',68400,68400,1],['B',69600,69600,2]]}
};
const source=(extra=[])=>({
 getTripResolved:async id=>details[id]??null,
 getTripStops:async id=>id==='incoming'?inside:outside,
 getBlockTrips:async()=>[
  {id:'incoming',routeId:'R5',startSeconds:66000},
  ...extra,
  {id:'outgoing',routeId:'R6',startSeconds:68400}]
});
const board={physicalStopIds:['P'],departures:[
 {trip:{id:'incoming'},stop:{id:'P'},route:{short_name:'5',type:0},scheduledSeconds:68400},
 {trip:{id:'outgoing'},stop:{id:'P'},route:{short_name:'6',type:0},scheduledSeconds:68400}
]};
test('verified immediate block handoff produces one outgoing row and incoming context',async()=>{
 const pair=await findBoardContinuations(board,date,68400,source());
 assert.equal(pair.size,1);
 assert.equal(pair.get('outgoing').incomingTripId,'incoming');
 const own=[stop('X','18:55:00','18:55:00',1),stop('P','19:00:00','19:00:00',2),
  stop('Y','19:03:00','19:03:00',3)];
 const parsed=parseNeighbourBoard({board,stop:own[1],ownTripId:'mine',ownStops:own,
  ownIndex:1,ownDelay:null,settings:DEFAULT_NEIGHBOUR_SETTINGS,distance:0,
  features:[],continuations:pair});
 assert.deepEqual(parsed.rows.map(v=>v.tripId),['outgoing']);
 assert.deepEqual(parsed.rows[0].transition?.fromTripId,'incoming');
 assert.equal(parsed.rows[0].line,'6');
});
test('same block alone cannot jump across an intermediate trip',async()=>{
 const pairs=await findBoardContinuations(board,date,68400,source([
  {id:'unrelated',routeId:'R7',startSeconds:67500}
 ]));
 assert.equal(pairs.size,0);
});
test('different verified physical edges must never merge',async()=>{
 const shifted={...board,physicalStopIds:['P','Q']};
 const s={...source(),getTripStops:async id=>id==='incoming'?inside:
 [stop('Q','19:00:00','19:00:00',1),outside[1]]};
 const pair=await findBoardContinuations(shifted,date,68400,s);
 // P and Q both in a VERIFIED single physical group; this is allowed.
 assert.equal(pair.size,1);
 assert.equal((await findBoardContinuations({...board,physicalStopIds:['P']},date,68400,s)).size,0);
});
test('long layover cannot be mistaken for one simultaneous arrival/departure',async()=>{
 const s={...source(),getTripStops:async id=>id==='incoming'?inside:
 [stop('P','19:08:00','19:08:00',1),outside[1]]};
 assert.equal((await findBoardContinuations(board,date,68400,s)).size,0);
});
test('when only one trip is visible, never hide its row',()=>{
 const own=[stop('X','18:55:00','18:55:00',1),stop('P','19:00:00','19:00:00',2)];
 const link=new Map([['outgoing',{incomingTripId:'incoming',blockId:'B'}]]);
 const parsed=parseNeighbourBoard({board:{...board,departures:board.departures.slice(1)},
 stop:own[1],ownTripId:'mine',ownStops:own,ownIndex:1,ownDelay:null,
 settings:DEFAULT_NEIGHBOUR_SETTINGS,distance:0,features:[],continuations:link});
 assert.equal(parsed.rows.length,1);
});