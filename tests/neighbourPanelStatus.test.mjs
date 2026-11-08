import test from 'node:test';
import assert from 'node:assert/strict';
import {neighbourBoardNotice} from '../src/neighbourPanelStatus.ts';
import {orderColour} from '../src/neighbourOrderColour.ts';
const base={ready:true,loading:false,error:'',rows:0,ownLive:true,verifiedPeers:0,liveIncomplete:false};

test('only a completed board can report that no near services were found',()=>{
 assert.equal(neighbourBoardNotice({...base,ready:false,loading:true}).kind,'loading');
 assert.equal(neighbourBoardNotice({...base,ready:false,error:'HTTP 429'}).kind,'error');
 assert.equal(neighbourBoardNotice({...base,loading:true}).kind,'loading');
 const none=neighbourBoardNotice(base);
 assert.equal(none.kind,'none');
 assert.match(none.detail,/dostupných údajích/i);
});
test('missing own LIVE or incomplete peer sampling cannot assert a verified empty result',()=>{
 for(const partial of [
  {...base,ownLive:false},{...base,liveIncomplete:true},
  {...base,error:'HTTP 429'}
 ]){
  const notice=neighbourBoardNotice(partial);
  assert.equal(notice.kind,'timetable');
  assert.match(notice.detail,/nelze vyloučit opožděný spoj/i);
 }
});
test('mixed LIVE/JŘ rows show partial coverage, never an all-live headline',()=>{
 assert.equal(neighbourBoardNotice({...base,rows:3,verifiedPeers:2}).kind,'partial');
 assert.equal(neighbourBoardNotice({...base,rows:3,verifiedPeers:3,ownLive:false}).kind,'partial');
 assert.equal(neighbourBoardNotice({...base,rows:3,verifiedPeers:3,liveIncomplete:true}).kind,'partial');
 assert.equal(neighbourBoardNotice({...base,rows:3,verifiedPeers:3}).kind,'live');
});
test('arrow and delay use exactly one orderColour decision; unknown LIVE remains neutral',()=>{
 assert.equal(orderColour('before',-80),'good');
 assert.equal(orderColour('before',85),'risk');
 assert.equal(orderColour('after',5),'uncertain');
 assert.equal(orderColour('before',null),'neutral');
 assert.equal(orderColour('after',null),'neutral');
});
