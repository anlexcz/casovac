import test from 'node:test';
import assert from 'node:assert/strict';
import {onlyPreviouslySharedPeers} from '../src/autoNeighbourNovelty.ts';

const peer=(tripId,previousId,previousScheduledSeconds=17*3600+50*60,delay=null)=>({
 tripId,previousId,previousScheduledSeconds,delay
});
const board=(rows,ownDelay=null)=>({
 rows,ownDelay,stopId:'C',ownSchedule:'17:55:00',significant:true
});
const prior={id:'B1',name:'B',arrival:'17:50:00',departure:'17:50:00',sequence:2};
const map={B1:'physical-B',B2:'physical-B',C1:'physical-C',OTHER:'physical-other'};

test('same trip on exact previous physical stop in the same time window is not a new alert',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1')]),prior,map),true);
});
test('different stop IDs mapped to one verified physical platform also count as already met',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('a','B1'),peer('b','B2')]),prior,map),true);
});
test('one newly joining service preserves the automatic panel',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1'),peer('new','OTHER')]),prior,map),false);
});
test('an unknown preceding stop or missing previous schedule cannot suppress',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1'),peer('unknown','')]),prior,map),false);
 assert.equal(onlyPreviouslySharedPeers(board([peer('unknown','B1',null)]),prior,map),false);
});
test('different unverified physical platform does not count as same edge',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('other','B2')]),prior,{}),false);
});
test('services using the same platform ten minutes apart never count as previously met',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('other','B1',18*3600)]),prior,map),false);
});
test('known opposing delays may separate two trips at the previous stop',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1',17*3600+51*60,150)],0),prior,map),false);
});
test('unknown own or peer delay cannot masquerade as a verified previous meeting',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1',17*3600+50*60,60)],null),prior,map),false);
});
test('empty or incomplete boards and missing own predecessor preserve normal zero-state handling',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([]),prior,map),false);
 assert.equal(onlyPreviouslySharedPeers(null,prior,map),false);
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1')]),undefined,map),false);
});
test('same line number arriving from a different platform is a new encounter',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('same-line-new-trip','OTHER')]),prior,map),false);
});
