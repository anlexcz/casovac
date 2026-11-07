import test from 'node:test';
import assert from 'node:assert/strict';
import {orderColour,scheduledSeconds,predictedArrivalClock} from '../src/neighbourOrderColour.ts';

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

test('predicted arrival is deliberately understated HH:mm and rounded to nearest minute',()=>{
 assert.equal(predictedArrivalClock(13*3600+43*60,4*60+59),'13:48');
 assert.equal(predictedArrivalClock(13*3600+49*60,48),'13:50');
 assert.equal(predictedArrivalClock(13*3600+49*60,0),'13:49');
});
test('predicted arrival handles negative deviation, GTFS 24+ times, and unknown delay',()=>{
 assert.equal(predictedArrivalClock(10,-120),'23:58');
 assert.equal(predictedArrivalClock(25*3600+60,0),'01:01');
 assert.equal(predictedArrivalClock(13*3600,null),null);
 assert.equal(predictedArrivalClock(NaN,60),null);
});
