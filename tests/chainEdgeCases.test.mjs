import test from 'node:test';
import assert from 'node:assert/strict';
import {findPlannedHandoff,verifyHandoffStops,departureForHandoff} from '../src/chainHandoff.ts';

const now=Date.parse('2026-11-06T10:00:00+01:00');
const current={line:'5',order:'12',tripId:'5_current',vehicle:'9200',start:'2026-11-06T09:05:00+01:00'};
const next={line:'6',order:'12',tripId:'6_next',vehicle:'9200',
 state:'before_track',start:'2026-11-06T10:05:00+01:00',
 lastStop:null,nextStop:null,rawTrip:{},source:'related'};
const snapshot={target:'5/12',vehicle:'9200',time:now-1000,relatedLine:'6',
 primary:[],related:[next],relatedTotal:1,error:'',loading:false};
const stop=(id,time)=>({id,name:id,sequence:1,arrival:time,departure:time,lat:null,lon:null});
const progress={index:3,predicted:false,reason:'',atStopAge:null,threshold:null};
const remote=(overrides={})=>({
 mode:'remote',status:'confirmed',index:3,lastConfirmedIndex:3,sourceAge:10,apiAge:5,
 sourceTimestamp:now-10000,reason:'',vehicleProgress:null,crossTrack:null,
 predictedProgress:null,estimatedSpeed:null,vehicleState:'at_stop',previousIndex:2,
 nextIndex:3,source:'sequence',...overrides
});
test('detects 5 to 6 successor when vehicle and order remain unchanged',()=>{
 assert.equal(findPlannedHandoff(snapshot,current,now)?.next.tripId,'6_next');
});
test('supports a changed order when the physical tram remains uniquely identified',()=>{
 const changed={...next,order:'13'};
 const result=findPlannedHandoff({...snapshot,related:[changed]},current,now);
 assert.equal(result?.next.order,'13');
 assert.match(result?.reason??'',/vozem/);
});
test('does not match another tram merely because it is on the paired line',()=>{
 const changed={...next,order:'13',vehicle:'9999'};
 assert.equal(findPlannedHandoff({...snapshot,related:[changed]},current,now),null);
});
test('rejects a successor too far in the future or with missing start',()=>{
 assert.equal(findPlannedHandoff({...snapshot,related:[{...next,start:'2026-11-06T12:00:00+01:00'}]},current,now),null);
 assert.equal(findPlannedHandoff({...snapshot,related:[{...next,start:null}]},current,now),null);
});
test('handoff GPS evidence requires fresh telemetry, even after positive detection',()=>{
 const gpsDeparture={phase:'left',displayIndex:3};
 const params={remote:remote(),progress,gpsDeparture,stopsCount:4,apiAge:5,now,sourceTripState:'on_track'};
 assert.equal(departureForHandoff(params).ok,true);
 assert.equal(departureForHandoff({...params,apiAge:51}).ok,false);
 assert.equal(departureForHandoff({...params,remote:remote({status:'off-route'})}).ok,false);
});
test('rejects incomplete timetable and different boundary platform',()=>{
 const a=[stop('A','10:00:00'),stop('X','10:05:00')];
 const b=[stop('X','10:05:00'),stop('B','10:08:00')];
 assert.equal(verifyHandoffStops(a,b).ok,true);
 assert.equal(verifyHandoffStops(a,[]).ok,false);
 assert.equal(verifyHandoffStops(a,[{...b[0],id:'Y'},b[1]]).ok,false);
});
