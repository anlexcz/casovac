import test from 'node:test';
import assert from 'node:assert/strict';
import {dutyPhase,displayDutyPhase} from '../src/trackedDuty.ts';
import {stableHeadway} from '../src/stableHeadway.ts';
const date='2026-11-08',now=Date.parse('2026-11-08T18:00:00Z');
const trip=(startSeconds,endSeconds)=>({tripId:'t',line:'5',startSeconds,endSeconds,terminalStopId:'END'});
test('headway is hidden before beginning, after ending and on an actual terminal layover',()=>{
 assert.equal(dutyPhase({date,now,candidates:[trip(19*3600+600,19*3600+900)]}),'before-service');
 assert.equal(dutyPhase({date,now,candidates:[trip(18*3600,18*3600+900)]}),'after-service');
 assert.equal(dutyPhase({date,now,candidates:[trip(18*3600+1800,19*3600+900)]}),'running');
 assert.equal(displayDutyPhase('running'),true);
 assert.equal(displayDutyPhase('after-service'),false);
});
test('last measured gap remains visible as last-known but is not LIVE after 90s',()=>{
 const key='d|peer|A';
 const s=stableHeadway(null,key,{seconds:230,order:'5'},now-1000,now);
 assert.equal(s.quality,'live');
 const stale=stableHeadway(s.snapshot,key,null,null,now+100000);
 assert.equal(stale.quality,'last-known');
 assert.equal(stale.seconds,230);
 assert.equal(stableHeadway(stale.snapshot,key,null,null,now+181000).quality,'plan');
 assert.equal(stableHeadway(s.snapshot,key+'B',null,null,now+30000).seconds,null);
});