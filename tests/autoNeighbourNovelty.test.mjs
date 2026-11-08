import test from 'node:test';
import assert from 'node:assert/strict';
import {onlyPreviouslySharedPeers} from '../src/autoNeighbourNovelty.ts';

const peer=(tripId,previousId)=>({tripId,previousId});
const board=(rows)=>({rows,stopId:'C',ownSchedule:'17:55:00',ownDelay:null,significant:true});
const map={B1:'physical-B',B2:'physical-B',C1:'physical-C',OTHER:'physical-other'};

test('an already-encountered trip on exact previous boarding edge is not a new alert',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1')]),'B1',map),true);
});
test('two trip IDs that previously served the same verified physical edge are both old',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('old-a','B1'),peer('old-b','B2')]),'B1',map),true);
});
test('one newly joining service keeps the automatic panel enabled',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1'),peer('new','OTHER')]),'B1',map),false);
});
test('a peer with unknown previous stop never counts as previously met',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1'),peer('unknown','')]),'B1',map),false);
});
test('different unverified platforms or stop names do not count as one edge',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('other','B2')]),'B1',{}),false);
});
test('zero neighbours, loading and missing own previous stop preserve the prior empty-board behavior',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([]),'B1',map),false);
 assert.equal(onlyPreviouslySharedPeers(null,'B1',map),false);
 assert.equal(onlyPreviouslySharedPeers(board([peer('old','B1')]),undefined,map),false);
});
test('a different physical predecessor does not count even with same line number',()=>{
 assert.equal(onlyPreviouslySharedPeers(board([peer('same-line-new-trip','OTHER')]),'B1',map),false);
});
