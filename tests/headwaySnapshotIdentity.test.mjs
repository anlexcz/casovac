import test from 'node:test';
import assert from 'node:assert/strict';
import {headwaySnapshotKey,mayPromoteHeadwaySnapshot} from '../src/headwaySnapshotIdentity.ts';
import {stableHeadway} from '../src/stableHeadway.ts';

const date='2026-11-08';
const own='2026-11-08|5/11';
const pair=(side,peerDutyId)=>headwaySnapshotKey({date,ownDutyId:own,peerDutyId,side});
const baseline=1000000;

test('same adjacent GTFS blocks retain the same gap across any reference stop or successor trip',()=>{
 const stableKey=pair('ahead','block:B-42');
 const first=stableHeadway(null,stableKey,{seconds:849,order:'4'},baseline,baseline+1000);
 assert.equal(first.seconds,849);
 const afterStop=stableHeadway(first.snapshot,stableKey,null,null,baseline+15000);
 assert.equal(afterStop.seconds,849);
 assert.equal(afterStop.quality,'live');
 const afterTripHandoff=stableHeadway(afterStop.snapshot,stableKey,null,null,baseline+100000);
 assert.equal(afterTripHandoff.seconds,849);
 assert.equal(afterTripHandoff.quality,'last-known');
});
test('failed requests and duplicate origin timestamps never overwrite previously confirmed seconds',()=>{
 const key=pair('behind','block:B-43');
 let value=stableHeadway(null,key,{seconds:826,order:'9'},baseline,baseline+3000);
 value=stableHeadway(value.snapshot,key,{seconds:701,order:'9'},baseline,baseline+20000);
 assert.equal(value.seconds,826);
 assert.equal(value.snapshot?.observedAt,baseline);
 value=stableHeadway(value.snapshot,key,null,null,baseline+80000);
 assert.equal(value.seconds,826);
});
test('genuinely newer joint observations update gap immediately',()=>{
 const key=pair('ahead','block:B-42');
 const first=stableHeadway(null,key,{seconds:849,order:'4'},baseline,baseline+1000);
 const next=stableHeadway(first.snapshot,key,{seconds:810,order:'4'},baseline+30000,baseline+31000);
 assert.equal(next.seconds,810);
 assert.equal(next.snapshot?.observedAt,baseline+30000);
});
test('a different scheduled duty or traffic direction never inherits the old gap',()=>{
 const original=pair('ahead','block:B-42');
 const snapshot=stableHeadway(null,original,{seconds:849,order:'4'},baseline,baseline+1000).snapshot;
 assert.equal(stableHeadway(snapshot,pair('ahead','block:B-99'),null,null,baseline+2000).seconds,null);
 assert.equal(stableHeadway(snapshot,pair('behind','block:B-42'),null,null,baseline+2000).seconds,null);
});
test('expired measurement stays out of LIVE while unchanged number is kept for three minutes',()=>{
 const key=pair('behind','block:B-43');
 const first=stableHeadway(null,key,{seconds:826,order:'9'},baseline,baseline+1000);
 assert.equal(stableHeadway(first.snapshot,key,null,null,baseline+90001).quality,'last-known');
 assert.equal(stableHeadway(first.snapshot,key,null,null,baseline+179999).seconds,826);
 assert.equal(stableHeadway(first.snapshot,key,null,null,baseline+180001).seconds,null);
});
test('safe one-time promotion from trip identity to verified block does not renew measured timestamp',()=>{
 const tripKey=pair('ahead','trip:old-trip'),blockKey=pair('ahead','block:verified-B');
 const first=stableHeadway(null,tripKey,{seconds:700,order:'7'},baseline,baseline+1000);
 assert.equal(mayPromoteHeadwaySnapshot({
  previousPeerTrip:'old-trip',nextPeerTrip:'old-trip',
  previousOwnDuty:own,nextOwnDuty:own,previousKey:tripKey,nextKey:blockKey
 }),true);
 const promoted={...first.snapshot,key:blockKey};
 const observed=stableHeadway(promoted,blockKey,null,null,baseline+70000);
 assert.equal(observed.seconds,700);
 assert.equal(observed.snapshot?.observedAt,baseline);
 assert.equal(mayPromoteHeadwaySnapshot({
  previousPeerTrip:'old-trip',nextPeerTrip:'new-trip',
  previousOwnDuty:own,nextOwnDuty:own,previousKey:tripKey,nextKey:blockKey
 }),false);
});
