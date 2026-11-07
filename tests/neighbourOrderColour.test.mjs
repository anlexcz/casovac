import test from 'node:test';
import assert from 'node:assert/strict';
import {orderColour,scheduledSeconds} from '../src/neighbourOrderColour.ts';

test('scheduled predecessor: expected earlier is green, expected later red',()=>{
 assert.equal(orderColour('before',-100),'good');
 assert.equal(orderColour('before',100),'risk');
});
test('scheduled successor: expected later is green, expected earlier red',()=>{
 assert.equal(orderColour('after',100),'good');
 assert.equal(orderColour('after',-100),'risk');
});
test('uncertain near simultaneous ETA and neutral for the same scheduled minute',()=>{
 assert.equal(orderColour('before',-10),'uncertain');
 assert.equal(orderColour('after',20),'uncertain');
 assert.equal(orderColour('same',-120),'neutral');
 assert.equal(orderColour('before',null),'neutral');
});
test('colour hysteresis holds status near threshold',()=>{
 assert.equal(orderColour('before',-24,30,'good',10),'good');
 assert.equal(orderColour('before',-15,30,'good',10),'uncertain');
 assert.equal(orderColour('after',-24,30,'risk',10),'risk');
 assert.equal(orderColour('after',-15,30,'risk',10),'uncertain');
});
test('GTFS service time including seconds is parsed for ETA comparisons',()=>{
 assert.equal(scheduledSeconds('10:29:30'),37770);
 assert.equal(scheduledSeconds('25:01:00'),90060);
 assert.equal(scheduledSeconds('bad'),null);
});
