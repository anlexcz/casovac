import test from 'node:test';
import assert from 'node:assert/strict';
import {foreignLineAtTransition} from '../src/headwayLinkEligibility.ts';

const link={firstId:'9_incoming',secondId:'10_follow',
 firstLine:'9',secondLine:'10',boundaryIndex:12};
const linked=new Map([['9_incoming',link],['10_current',{
 firstId:'10_current',secondId:'9_follow',firstLine:'10',secondLine:'9',boundaryIndex:15
}]]);
const incoming=(peerIndex,peerRef,ownIndex=0)=>foreignLineAtTransition({
 ownId:'10_live',peerId:'9_incoming',ownLine:'10',peerLine:'9',
 reference:{ownIndex,peerIndex,ownRef:ownIndex,peerRef},links:linked
});
test('10 just after the verified 9→10 terminal may compare the approaching 9',()=>{
 assert.equal(incoming(11,12),true);
 assert.equal(incoming(11,13,1),true);
 assert.equal(incoming(12,13,1),true);
});
test('10 well beyond terminal NEVER keeps 9 as a neighbouring service',()=>{
 assert.equal(incoming(11,14,2),false);
 assert.equal(incoming(11,19,7),false);
 assert.equal(incoming(12,20,8),false);
});
test('9 remote from transition does not count merely because its concatenated trip reaches 10',()=>{
 assert.equal(incoming(3,12),false);
 assert.equal(incoming(10,13),false);
});
const outgoing=(ownIndex,ownRef,peerIndex)=>foreignLineAtTransition({
 ownId:'10_current',peerId:'9_future',ownLine:'10',peerLine:'9',
 reference:{ownIndex,ownRef,peerIndex,peerRef:peerIndex},links:linked
});
test('10 nearing its verified 10→9 terminal can compare the first stop of 9',()=>{
 assert.equal(outgoing(14,14,0),true);
 assert.equal(outgoing(15,15,1),true);
});
test('10 midway along route does not compare 9 at its future terminal',()=>{
 assert.equal(outgoing(4,15,0),false);
 assert.equal(outgoing(11,15,0),false);
 assert.equal(outgoing(15,15,3),false);
});
test('shared-track route with no exact verified trip link is never allowed',()=>{
 assert.equal(foreignLineAtTransition({ownId:'10_live',peerId:'9_other',
  ownLine:'10',peerLine:'9',reference:{ownIndex:0,peerIndex:12,ownRef:0,peerRef:12},
  links:linked}),false);
});
