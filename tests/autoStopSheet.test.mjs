import test from 'node:test';
import assert from 'node:assert/strict';
import {isAutoStopActive} from '../src/autoStopSheet.ts';

test('automatic neighbours remain visible after losing live candidates while same stop is active',()=>{
 const pinned={tripId:'line-9-trip',index:4};
 assert.equal(isAutoStopActive(pinned,'line-9-trip',3,12),true);
 assert.equal(isAutoStopActive(pinned,'line-9-trip',4,12),true);
});
test('automatic neighbours close only after moving past target stop',()=>{
 const pinned={tripId:'line-9-trip',index:4};
 assert.equal(isAutoStopActive(pinned,'line-9-trip',5,12),false);
});
test('a new trip or invalid stop never inherits an old sheet',()=>{
 assert.equal(isAutoStopActive({tripId:'old',index:4},'new',3,12),false);
 assert.equal(isAutoStopActive({tripId:'old',index:4},'old',null,12),false);
 assert.equal(isAutoStopActive({tripId:'old',index:12},'old',10,12),false);
 assert.equal(isAutoStopActive(null,'old',4,12),false);
});
