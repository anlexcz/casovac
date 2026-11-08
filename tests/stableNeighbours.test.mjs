import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyStableNeighbours,reconcileNeighbours} from '../src/stableNeighbours.ts';

const row=(tripId,scheduledSeconds,delay=0)=>({
 tripId,line:'9',order:'22',vehicle:'9362',scheduled:'09:35:00',
 scheduledSeconds,delay,relative:scheduledSeconds<34500?'before':'after',
 predictedDifference:delay,previousId:'A',nextId:'B'
});
test('telemetry refresh changes values without removing or reordering a known trip',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440,60),row('b',34740,0)],1000,true,1000);
 state=reconcileNeighbours(state,[row('b',34740,80),row('a',34440,120)],2000,true,2000);
 assert.deepEqual(state.entries.map(e=>e.row.tripId),['a','b']);
 assert.deepEqual(state.entries.map(e=>e.row.delay),[120,80]);
 assert.equal(state.entries.some(e=>e.exiting),false);
});
test('partial Golemio batches never remove old rows',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440),row('b',34740)],1000,true,1000);
 state=reconcileNeighbours(state,[],2000,false,60000);
 assert.deepEqual(state.entries.map(e=>[e.row.tripId,e.missingCycles]),[['a',0],['b',0]]);
 assert.equal(state.entries.some(e=>e.exiting),false);
});
test('verified predecessor persists even after passing platform and many completed polls',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440)],1000,true,1000);
 state=reconcileNeighbours(state,[],4000,true,24000);
 assert.equal(state.entries[0].exiting,false);
 state=reconcileNeighbours(state,[],4000,true,25000);
 assert.equal(state.entries[0].missingCycles,1);
 state=reconcileNeighbours(state,[],35000,true,36000);
 assert.equal(state.entries[0].exiting,false);
 assert.equal(state.entries[0].row.tripId,'a');
});
test('a briefly missing tram can return without remounting the existing row',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440,50)],1000,true,1000);
 state=reconcileNeighbours(state,[],30000,true,30000);
 state=reconcileNeighbours(state,[row('a',34440,80)],40000,true,40000);
 assert.equal(state.entries[0].exiting,false);
 assert.equal(state.entries[0].missingCycles,0);
 assert.equal(state.entries[0].row.delay,80);
});
test('new trips insert by fixed scheduled time, not delay',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440,500)],1000,true,1000);
 state=reconcileNeighbours(state,[row('b',34200,-100),row('a',34440,500)],2000,false,2000);
 assert.deepEqual(state.entries.map(e=>e.row.tripId),['b','a']);
});

test('one missing complete LIVE cycle retains last valid delay and identity',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440,90)],1000,true,1000);
 state=reconcileNeighbours(state,[],61000,true,61000);
 assert.equal(state.entries[0].row.delay,90);
 assert.equal(state.entries[0].row.vehicle,'9362');
 assert.equal(state.entries[0].missingCycles,1);
 assert.equal(state.entries[0].lastLiveAt,1000);
});
test('new GTFS result with missing LIVE does not erase last valid deviation',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440,150)],1000,true,1000);
 state=reconcileNeighbours(state,[{...row('a',34440,null),order:'?',vehicle:''}],62000,true,62000);
 assert.equal(state.entries[0].row.delay,150);
 assert.equal(state.entries[0].row.order,'22');
 assert.equal(state.entries[0].row.vehicle,'9362');
 assert.equal(state.entries[0].lastLiveAt,1000);
});
test('materially changed delay is applied immediately and refreshes evidence timestamp',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440,150)],1000,true,1000);
 state=reconcileNeighbours(state,[row('a',34440,-100)],65000,true,65000);
 assert.equal(state.entries[0].row.delay,-100);
 assert.equal(state.entries[0].lastLiveAt,65000);
});
test('cached deviation expires after three minutes without renewing it on failed polls',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440,90)],1000,true,1000);
 state=reconcileNeighbours(state,[],61000,true,61000);
 state=reconcileNeighbours(state,[row('a',34440,null)],121000,true,121000);
 assert.equal(state.entries[0].row.delay,90);
 state=reconcileNeighbours(state,[row('a',34440,null)],181000,true,181000);
 assert.equal(state.entries[0].row.delay,null);
 assert.equal(state.entries[0].lastLiveAt,1000);
});
test('same trip with a different scheduled stop is not allowed to reuse old LIVE deviation',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('a',34440,90)],1000,true,1000);
 state=reconcileNeighbours(state,[row('a',34800,null)],30000,true,30000);
 assert.equal(state.entries[0].row.scheduledSeconds,34800);
 assert.equal(state.entries[0].row.delay,null);
 assert.equal(state.entries[0].lastLiveAt,null);
});

test('validated incoming -> outgoing block handoff removes the previous arrival row even from retained cache',()=>{
 let state=reconcileNeighbours(emptyStableNeighbours(),[row('incoming',68400,60)],1000,true,1000);
 const outgoing={...row('outgoing',68400,null),transition:{
  fromTripId:'incoming',fromLine:'5',fromOrder:'11',arrivalSeconds:68400,
  fromVehicle:'9272',fromDelay:60,blockId:'B'
 }};
 state=reconcileNeighbours(state,[outgoing],61000,true,61000);
 assert.deepEqual(state.entries.map(e=>e.row.tripId),['outgoing']);
 assert.equal(state.entries[0].row.transition.fromTripId,'incoming');
});
