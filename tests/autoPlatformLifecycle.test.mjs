import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedAtStop,confirmedBeyondStop,pickAutoPlatform,platformMarkers} from '../src/autoPlatformLifecycle.ts';

const stops=['A','B','C','D'].map((id,i)=>({id,name:id,sequence:i+1,
 arrival:'10:00:00',departure:'10:00:00',lat:null,lon:null}));
const map={A:'P/A',B:'P/B',C:'P/C',D:'P/D'};
const entries=[
 [3,'P/C','mixed-platform',[]],
 [4,'P/D','tram-branch-candidate',['other']]
];
const state=(state='on_track',previousIndex=null,nextIndex=1,fresh=true)=>({
 state,previousIndex,nextIndex,fresh
});
const pick=(overrides={})=>pickAutoPlatform({
 stops,currentIndex:1,entries,stopMap:map,
 evidence:state(),remainingToCurrent:35,remainingToTarget:()=>80,
 leadSeconds:90,...overrides
});
test('stop-list markers come only from exact trip sequence and verified physical edge',()=>{
 const x=platformMarkers(stops,[
  [3,'P/C','shared-platform',[]],[3,'P/C','tram-route-set',[]],
  [2,'P/B','mixed-platform',[]],[4,'P/WRONG','tram-route-set',[]]
 ],map);
 assert.deepEqual(x,{1:'mixed',2:'join'});
});
test('opens verified mixed platform before reaching its preceding stop',()=>{
 assert.deepEqual(pick(),{index:2,physicalId:'P/C',kind:'mixed-platform'});
 assert.equal(pick({remainingToCurrent:130}),null);
});
test('manual timetable browsing never counts as evidence for an automatic preview',()=>{
 assert.equal(pick({currentIndex:null}),null);
});
test('arrival at predecessor is sufficient to open even if timetable estimate is stale',()=>{
 assert.equal(pick({evidence:state('at_stop',1,2),remainingToCurrent:999})?.index,2);
});
test('shape-confirmed tram confluence opens even without a nearby scheduled peer',()=>{
 const target=pick({entries:[[3,'P/C','tram-branch-confirmed',[]]]});
 assert.deepEqual(target,{index:2,physicalId:'P/C',kind:'tram-branch-confirmed'});
});
test('directional line set is important while ordinary shared-line stop needs all mode',()=>{
 const joining=pick({entries:[[3,'P/C','tram-route-set',[]]]});
 assert.equal(joining?.kind,'tram-route-set');
 const ordinary=[[3,'P/C','shared-platform',[]]];
 assert.equal(pick({entries:ordinary}),null);
 assert.equal(pick({entries:ordinary,mode:'important'}),null);
 assert.equal(pick({entries:ordinary,mode:'all'})?.index,2);
});
test('a branch candidate alone never triggers automatic opening before geometry verification',()=>{
 assert.equal(pick({entries:entries.slice(1),currentIndex:2,remainingToCurrent:20}),null);
});
test('invalid or missing exact PID physical ID never triggers',()=>{
 assert.equal(pick({stopMap:{...map,C:'P/other'}}),null);
 assert.equal(pick({stops:stops.map(s=>s.id==='C'?{...s,id:''}:s)}),null);
});
test('only fresh confirmed movement can close a pinned panel',()=>{
 assert.equal(confirmedBeyondStop(state('on_track',1,3),2),true);
 assert.equal(confirmedBeyondStop(state('on_track',1,3,false),2),false);
 assert.equal(confirmedBeyondStop(state('at_stop',2,3),2),false);
 assert.equal(confirmedBeyondStop(state('at_stop',3,3),2),true);
});
test('adjacent connection transfers at confirmed arrival; not a timetable-only change',()=>{
 assert.equal(confirmedAtStop(state('at_stop',2,3),2),true);
 assert.equal(confirmedAtStop(state('on_track',2,3),2),false);
 assert.equal(confirmedAtStop(state('at_stop',2,3,false),2),false);
 const atB=pick({
  entries:[[3,'P/C','mixed-platform',[]]],
  currentIndex:1,remainingToCurrent:130,
  evidence:state('at_stop',1,2)
 });
 assert.equal(atB?.index,2);
});
test('repeated occurrence keeps sequence and does not blend two identical names',()=>{
 const loop=[...stops,{...stops[2],sequence:5}];
 const res=pick({stops:loop,entries:[[5,'P/C','mixed-platform',[]]],
  currentIndex:3,remainingToCurrent:30,evidence:state('on_track',2,3)});
 assert.equal(res?.index,4);
});
