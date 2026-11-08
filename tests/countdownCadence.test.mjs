import test from 'node:test';
import assert from 'node:assert/strict';
import {countdownSeconds} from '../src/tripData.ts';
import {OWN_VEHICLE_POLL_MS,OWN_VEHICLE_RETAIN_MS,NEIGHBOUR_POLL_MS,NEIGHBOUR_RETAIN_MS,UPCOMING_STOP_COUNT} from '../src/pollingCadence.ts';

const local=(h,m,s)=>new Date(2026,10,8,h,m,s).getTime();

test('existing traffic sign convention remains unchanged: before negative, after positive',()=>{
 const ahead=countdownSeconds('17:06:00',local(17,5,25));
 const late=countdownSeconds('17:06:00',local(17,6,35));
 assert.equal(ahead,35);
 assert.equal(late,-35);
 // StopBoard.signed displays the NEGATIVE of countdownSeconds.
 assert.equal(-ahead,-35);
 assert.equal(-late,35);
});
test('wall clock continuously changes timetable countdown without needing a LIVE refresh',()=>{
 const values=[0,10,20,35,55,70].map(t=>
  countdownSeconds('17:06:00',local(17,5,0)+t*1000));
 assert.deepEqual(values,[60,50,40,25,5,-10]);
});
test('own vehicle polling permits three missed 20-second updates for identity retention',()=>{
 assert.equal(OWN_VEHICLE_POLL_MS,20000);
 assert.equal(OWN_VEHICLE_RETAIN_MS,60000);
 assert.equal(NEIGHBOUR_POLL_MS,60000);
 assert.equal(NEIGHBOUR_RETAIN_MS,180000);
 assert.equal(UPCOMING_STOP_COUNT,3);
});
