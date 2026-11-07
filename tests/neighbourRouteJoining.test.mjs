import test from 'node:test';
import assert from 'node:assert/strict';
import {joiningCorridor} from '../src/neighbourRouteJoining.ts';

const s=(name,time,id='',lat=null,lon=null)=>({id,name,sequence:1,
 arrival:time,departure:time,lat,lon,platformCode:''});
const ours=[
 s('Výtoň','12:32:00'),
 s('Palackého náměstí','12:34:00','U101'),
 s('Zborovská','12:36:00')
];
test('Palackého náměstí: lines that arrive with us and diverge do not auto-open',()=>{
 const peer=[
  s('Výtoň','12:31:00'),
  s('Palackého náměstí','12:34:00'),
  s('Jiráskovo náměstí','12:36:00')
 ];
 assert.deepEqual(joiningCorridor(ours,1,peer,45240,'U101'),
  {joining:false,reason:'different-outgoing'});
});
test('same incoming and outgoing section is a continuation, not a new join',()=>{
 const peer=[s('Výtoň','12:31:00'),s('Palackého náměstí','12:34:00'),
  s('Zborovská','12:36:00')];
 assert.equal(joiningCorridor(ours,1,peer,45240,'U101').reason,'same-incoming');
});
test('new incoming branch sharing next section is an actual join',()=>{
 const peer=[s('Karlovo náměstí','12:31:00'),
  s('Palackého náměstí','12:34:00'),s('Zborovská','12:36:00')];
 assert.deepEqual(joiningCorridor(ours,1,peer,45240,'U101'),
  {joining:true,reason:'joining'});
});
test('unverified or ambiguous routes must never trigger automatic opening',()=>{
 const ambiguous=[
  s('Karlovo náměstí','12:31:00'),s('Palackého náměstí','12:34:00'),
  s('Zborovská','12:36:00'),s('Palackého náměstí','12:34:00'),
  s('Zborovská','12:37:00')
 ];
 assert.equal(joiningCorridor(ours,1,[],45240,'U101').joining,false);
 assert.equal(joiningCorridor(ours,1,ambiguous,45240,'U101').joining,false);
});
test('platform mismatch blocks matching when both authoritative IDs exist',()=>{
 const peer=[s('Karlovo náměstí','12:31:00'),
  s('Palackého náměstí','12:34:00','U999'),
  s('Zborovská','12:36:00')];
 assert.equal(joiningCorridor(ours,1,peer,45240,'U101').joining,false);
});
