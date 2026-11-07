import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChooserQuery,originRouteOf,queryMatches,resolveChooserMatches} from '../src/chooserSearch.ts';
const now=Date.parse('2026-11-07T13:35:00+01:00');
const feature=(current,origin,order,car,state='on_track',tripId='a')=>({
 properties:{trip:{gtfs:{route_short_name:current,trip_id:tripId},origin_route_name:origin,
  sequence_id:order,vehicle_registration_number:car,
  start_timestamp:'2026-11-07T13:34:00+01:00'},
  last_position:{state_position:state,origin_timestamp:'2026-11-07T13:35:00+01:00'}}
});
test('one input recognizes current route, current/core order and explicit car registration',()=>{
 assert.deepEqual(parseChooserQuery(' 2 '),{kind:'route',line:'2'});
 assert.deepEqual(parseChooserQuery('02 / 071'),{kind:'order',line:'2',order:'71'});
 assert.deepEqual(parseChooserQuery('91/71'),{kind:'order',line:'91',order:'71'});
 assert.deepEqual(parseChooserQuery('#8266'),{kind:'vehicle',vehicle:'8266'});
 assert.deepEqual(parseChooserQuery('8266'),{kind:'invalid'});
 assert.deepEqual(parseChooserQuery('2/'),{kind:'route',line:'2'});
 assert.deepEqual(parseChooserQuery('#'),{kind:'invalid'});
});
test('origin_route_name can differ from current route, never inferred from the current route',()=>{
 const f=feature('2','91',71,8266);
 assert.equal(originRouteOf(f),'91');
 assert.equal(queryMatches(f,parseChooserQuery('2/71')),true);
 assert.equal(queryMatches(f,parseChooserQuery('91/71')),true);
 assert.equal(queryMatches(f,parseChooserQuery('91')),false);
 assert.equal(queryMatches(f,parseChooserQuery('#8266')),true);
 assert.equal(queryMatches(f,parseChooserQuery('#8267')),false);
});
test('cross-route search groups active and prepared GTFS records by stable core order',()=>{
 const ended=feature('91','91',71,8266,'after_track','old');
 const current=feature('2','91',71,8266,'on_track','now');
 const prepared=feature('91','91',71,8266,'before_track','next');
 const matches=resolveChooserMatches([ended,current,prepared],parseChooserQuery('91/71'),now);
 assert.equal(matches.length,1);
 assert.deepEqual([matches[0].line,matches[0].order,matches[0].originRoute,matches[0].car],
  ['2','71','91','8266']);
});
test('current-line list stays compact, grouped by actual line/order regardless of trip count',()=>{
 const a=feature('2','91',71,8266,'on_track','a');
 const b=feature('2','91',71,8266,'before_track','b');
 const c=feature('2','91',72,8261,'on_track','c');
 const matches=resolveChooserMatches([a,b,c],parseChooserQuery('2'),now);
 assert.deepEqual(matches.map(x=>x.order),['71','72']);
});
test('vehicle search resolves current operating route even when core route differs',()=>{
 const result=resolveChooserMatches([feature('2','91',71,8266)],parseChooserQuery('#8266'),now);
 assert.equal(result.length,1);
 assert.deepEqual([result[0].line,result[0].order,result[0].originRoute],['2','71','91']);
});
test('different operating-order identities are not conflated merely because the car matches',()=>{
 const a=feature('2','91',71,8266);
 const b=feature('2','91',72,8266);
 const matches=resolveChooserMatches([a,b],parseChooserQuery('#8266'),now);
 assert.equal(matches.length,2);
});
test('two simultaneously active different cars with same core identity are ambiguous',()=>{
 const a=feature('2','91',71,8266,'on_track','a');
 const b=feature('91','91',71,8267,'at_stop','b');
 const matches=resolveChooserMatches([a,b],parseChooserQuery('91/71'),now);
 assert.equal(matches.length,1);
 assert.equal(matches[0].ambiguous,true);
});
test('non-tram and malformed trip numbers do not generate phantom orders',()=>{
 const invalid=feature('2','91','-',8266);
 assert.equal(resolveChooserMatches([invalid],parseChooserQuery('#8266'),now).length,0);
});

test('2/7 matches actual order 7 and all orders beginning with 7 including 71, 72 and 79',()=>{
 const fleet=[
  feature('2','91',7,8270,'on_track','7'),
  feature('2','91',71,8266,'on_track','71'),
  feature('2','91',72,8261,'on_track','72'),
  feature('2','91',79,8269,'on_track','79'),
  feature('2','91',8,8278,'on_track','8'),
  feature('21','91',73,8290,'on_track','21_73')
 ];
 const matches=resolveChooserMatches(fleet,parseChooserQuery('2/7'),now);
 assert.deepEqual(matches.map(item=>item.order),['7','71','72','79']);
 assert.ok(matches.every(item=>item.originRoute==='91'));
});
test('91/7 also searches prefixes of core order across current routes',()=>{
 const matches=resolveChooserMatches([
  feature('2','91',71,8266,'on_track','a'),
  feature('3','91',72,8261,'on_track','b'),
  feature('9','91',85,9200,'on_track','c')
 ],parseChooserQuery('91/7'),now);
 assert.deepEqual(matches.map(x=>x.order),['71','72']);
});
