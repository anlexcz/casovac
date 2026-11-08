import test from 'node:test';
import assert from 'node:assert/strict';
import {exactTripPosition,freshTripPosition,tripPositionUrl} from '../src/usePlannedPeerPositions.ts';

const now=Date.now();
const peer={tripId:'9_123_261108',line:'9',order:'',scheduledGap:180,
 departureSeconds:45000,referenceStopId:'U123Z1P'};
const feature=(id='9_123_261108',line='9',age=10,state='on_track')=>({
 type:'Feature',geometry:{type:'Point',coordinates:[14.4,50.1]},
 properties:{
  trip:{gtfs:{trip_id:id,route_short_name:line},
   sequence_id:23,vehicle_registration_number:'9147'},
  last_position:{state_position:state,
   origin_timestamp:new Date(now-age*1000).toISOString(),delay:{actual:42}}
 }
});
test('requests the exact GTFS trip, not an unfiltered line or vehicle list',()=>{
 const url=new URL(tripPositionUrl(peer.tripId));
 assert.equal(url.pathname,'/v2/vehiclepositions/9_123_261108');
 assert.equal(url.searchParams.get('includeNotTracking'),'true');
 assert.equal(url.searchParams.has('routeShortName'),false);
});
test('accepts exactly matching single Feature, including wrapped singleton',()=>{
 const value=feature();
 assert.deepEqual(exactTripPosition(value,peer),value);
 assert.deepEqual(exactTripPosition({type:'FeatureCollection',features:[value]},peer),value);
});
test('never accepts a route-mismatched, stale-identity or ambiguous response',()=>{
 assert.equal(exactTripPosition(feature('9_999_261108'),peer),null);
 assert.equal(exactTripPosition(feature(peer.tripId,'10'),peer),null);
 assert.equal(exactTripPosition({features:[feature(),feature()]},peer),null);
 assert.equal(exactTripPosition({features:[]},peer),null);
 assert.equal(exactTripPosition(null,peer),null);
});
test('only uses sufficiently fresh active trip positions for spacing',()=>{
 assert.equal(freshTripPosition(feature(),now),true);
 assert.equal(freshTripPosition(feature(peer.tripId,'9',130),now),false);
 assert.equal(freshTripPosition(feature(peer.tripId,'9',10,'before_track'),now),false);
});
