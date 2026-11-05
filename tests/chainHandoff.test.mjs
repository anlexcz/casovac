import test from 'node:test';
import assert from 'node:assert/strict';
import {findPlannedHandoff,verifyHandoffStops,departureForHandoff} from '../src/chainHandoff.ts';
import {continuousStops} from '../src/chainStops.ts';
import {selectTrip} from '../src/tripSelection.ts';

const now=Date.parse('2026-11-05T16:23:00+01:00');
const next={line:'9',order:'21',tripId:'9_30458_261012',vehicle:'9383',
 state:'before_track_delayed',start:'2026-11-05T16:28:00+01:00',
 lastStop:null,nextStop:{id:'U469Z3P',sequence:1},rawTrip:{},source:'návazná linka'};
const snapshot={target:'10/21',vehicle:'9383',time:now-5000,relatedLine:'9',
 primary:[],related:[next],relatedTotal:58,error:'',loading:false};
const current={line:'10',order:'21',tripId:'10_16745_261012',vehicle:'9383',start:'2026-11-05T15:43:00+01:00'};
function stop(id,time,sequence=1){return {id,name:id,sequence,arrival:time,departure:time,lat:null,lon:null};}
function remote(state,prev,nextIndex,sourceAge=12){return {
 status:'confirmed',sourceAge,apiAge:5,vehicleState:state,previousIndex:prev,nextIndex,
 index:nextIndex,mode:'remote',lastConfirmedIndex:nextIndex,sourceTimestamp:now-12000,
 reason:'',vehicleProgress:null,crossTrack:null,predictedProgress:null,estimatedSpeed:null,source:'sequence'
};}
const progress={index:27,predicted:false,reason:'',atStopAge:null,threshold:null};
const gps={phase:'waiting',displayIndex:27};
test('identifies 10 → 9 from the real observed trip IDs',()=>{
 assert.equal(findPlannedHandoff(snapshot,current,now)?.next.tripId,next.tripId);
});
test('keeps the order when a replacement tram takes over',()=>{
 assert.equal(findPlannedHandoff({...snapshot,vehicle:'9384'}, {...current,vehicle:'9384'},now)?.next.tripId,next.tripId);
});
test('rejects different order and different tram',()=>{
 assert.equal(findPlannedHandoff({...snapshot,related:[{...next,vehicle:'9999',order:'22'}]},current,now),null);
});
test('rejects stale and unrelated snapshots',()=>{
 assert.equal(findPlannedHandoff({...snapshot,time:now-200000},current,now),null);
 assert.equal(findPlannedHandoff({...snapshot,target:'10/22'},current,now),null);
});
test('keeps candidate while next diagnostic request is still loading',()=>{
 assert.ok(findPlannedHandoff({...snapshot,loading:true},current,now));
});
test('rejects ambiguous same-minute prepared trips',()=>{
 assert.equal(findPlannedHandoff({...snapshot,related:[next,{...next,tripId:'alternative'}]},current,now),null);
});
test('requires identical boundary stop and adjacent times',()=>{
 const prev=[stop('BEFORE','16:26:00'),stop('U469Z3P','16:28:00',2)];
 const following=[stop('U469Z3P','16:28:00'),stop('AFTER','16:30:00',2)];
 assert.equal(verifyHandoffStops(prev,following).ok,true);
 assert.equal(verifyHandoffStops(prev,[{...following[0],id:'DIFFERENT'},following[1]]).ok,false);
 assert.equal(verifyHandoffStops(prev,[{...following[0],arrival:'16:35:00',departure:'16:35:00'},following[1]]).ok,false);
});
test('handles a GTFS 24:00 boundary',()=>{
 assert.equal(verifyHandoffStops(
  [stop('A','23:55:00'),stop('X','24:01:00',2)],
  [stop('X','00:01:00'),stop('Y','00:05:00',2)]
 ).ok,true);
});
test('switches after confirmed penultimate departure, not while stopped',()=>{
 const common={stopsCount:28,apiAge:5,now,sourceTripState:'on_track',progress,gpsDeparture:gps};
 assert.equal(departureForHandoff({...common,remote:remote('at_stop',26,27)}).ok,false);
 assert.equal(departureForHandoff({...common,remote:remote('on_track',26,27)}).ok,true);
 assert.equal(departureForHandoff({...common,remote:remote('on_track',25,26)}).ok,false);
});
test('never switches on stale vehicle telemetry',()=>{
 const common={stopsCount:28,apiAge:5,now,sourceTripState:'on_track',progress,gpsDeparture:gps};
 assert.equal(departureForHandoff({...common,remote:remote('on_track',26,27,130)}).ok,false);
});

test('joins the trip stops without duplicating the transition platform',()=>{
 const currentStops=[stop('A','16:24:00'),stop('X','16:28:00',2)];
 const nextStops=[stop('X','16:28:00'),stop('B','16:30:00',2),stop('C','16:33:00',3)];
 const joined=continuousStops(currentStops,nextStops,true);
 assert.deepEqual(joined.map(x=>x.stop.id),['A','X','B','C']);
 assert.deepEqual(joined.map(x=>x.continuation),[false,false,true,true]);
});
test('does not append unverified trip stops',()=>{
 const before=[stop('A','16:24:00'),stop('X','16:28:00',2)];
 const after=[stop('X','16:28:00'),stop('B','16:30:00',2)];
 assert.equal(continuousStops(before,after,false).length,2);
 assert.equal(continuousStops(before,[{...after[0],id:'OTHER'},after[1]],true).length,2);
});

const vehicleFeature=(car,state,timestamp)=>({
 properties:{trip:{gtfs:{route_short_name:'6',trip_id:'6_30255_261019'},
  sequence_id:1,vehicle_registration_number:car,start_timestamp:'2026-11-05T15:55:00+01:00'},
  last_position:{state_position:state,origin_timestamp:new Date(timestamp).toISOString()}}
});
test('follows a replacement active tram for the same operating order',()=>{
 const old=vehicleFeature(9233,'after_track',now-40000);
 const replacement=vehicleFeature(9147,'on_track',now-5000);
 assert.equal(selectTrip([old,replacement],'6','1',now,'9233').vehicle,'9147');
});
test('prefers an unambiguously fresher car during overlapping active reports',()=>{
 const old=vehicleFeature(9233,'at_stop',now-65000);
 const replacement=vehicleFeature(9147,'on_track',now-5000);
 assert.equal(selectTrip([old,replacement],'6','1',now,'9233').vehicle,'9147');
});
test('declines ambiguous simultaneous vehicle reports for one order',()=>{
 const first=vehicleFeature(9233,'at_stop',now-15000);
 const second=vehicleFeature(9147,'on_track',now-5000);
 const result=selectTrip([first,second],'6','1',now,'9233');
 assert.equal(result.ambiguous,true);
 assert.equal(result.feature,null);
});
