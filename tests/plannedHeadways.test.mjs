import test from 'node:test';
import assert from 'node:assert/strict';
import {findPlannedHeadways} from '../src/plannedHeadways.ts';
const day='2026-11-08';
const t=(id,route,times,stopIds=['A','B','C'])=>({
 id,date:day,routeId:route,serviceId:'S',headsign:'Směr',directionId:'0',
 blockId:'',shapeId:'shape',shortName:'',
 stopTimes:stopIds.map((s,i)=>[s,times[i],times[i],i+1,'1'])
});
const clock=s=>[Math.floor(s/3600),Math.floor(s%3600/60),s%60]
 .map(x=>String(x).padStart(2,'0')).join(':');
const base=86400;
function data(){
 const trips=[
  t('mine','L12',[base+600,base+720,base+840]),
  t('before','L12',[base+360,base+480,base+600]),
  t('after','L12',[base+900,base+1020,base+1140]),
  t('opposite','L12',[base+540,base+660,base+780],['B','X','A']),
  t('other','L24',[base+480,base+600,base+720]),
  t('far','L12',[base+3000,base+3120,base+3240])
 ];
 const map=new Map(trips.map(x=>[x.id,x]));
 const calls={departures:0,trips:0,stops:0};
 const source={
  async getTripResolved(id,d){calls.trips++;return d===day?map.get(id)??null:null;},
  async getTripStops(id){calls.stops++;
   const trip=map.get(id);
   return trip?.stopTimes.map(([stop,a,d,index])=>({
    id:stop,name:stop,sequence:index,arrival:clock(a),departure:clock(d),
    lat:50+index/100,lon:14+index/100,platformCode:'A',physicalId:stop
   }))??null;},
  async getDepartures(stopId,d){calls.departures++;
   if(d!==day)return [];
   return [...map.values()].filter(trip=>trip.stopTimes.some(x=>x[0]===stopId))
    .map(trip=>{
     const stop=trip.stopTimes.find(x=>x[0]===stopId);
     return {stopId,date:d,tripId:trip.id,routeId:trip.routeId,
      departureSeconds:stop[2],stopSequence:stop[3]};
    });
  },
  async getRoutes(){return {L12:['12','','','','',''],L24:['24','','','','','']};}
 };
 return {map,source,calls};
}
test('PLAN finds nearest before and after using only static GTFS departures over 24:00',async()=>{
 const {source,calls}=data();
 const result=await findPlannedHeadways({tripId:'mine',date:day,referenceStopId:'A',source});
 assert.equal(result.status,'ready');
 assert.equal(result.ahead?.tripId,'before');
 assert.equal(result.ahead?.scheduledGap,240);
 assert.equal(result.behind?.tripId,'after');
 assert.equal(result.behind?.scheduledGap,300);
 assert.equal(result.ahead?.line,'12');
 assert.equal(result.ahead?.order,'');
 assert.equal(calls.departures,1);
});
test('unrelated route and opposite direction must not become planned neighbours',async()=>{
 const {source,map}=data();
 map.delete('before');map.delete('after');
 const result=await findPlannedHeadways({tripId:'mine',date:day,referenceStopId:'A',source});
 assert.equal(result.ahead,null);
 assert.equal(result.behind,null);
 assert.equal(result.status,'ready');
});
test('no guessing trip/date/stop, and no use of wall-clock service date',async()=>{
 const {source}=data();
 for(const req of [
  {tripId:'mine',date:'2026-11-09',referenceStopId:'A'},
  {tripId:'mine',date:day,referenceStopId:'C'},
  {tripId:'missing',date:day,referenceStopId:'A'},
  {tripId:'mine',date:day,referenceStopId:'unknown'}
 ]){
  const r=await findPlannedHeadways({...req,source});
  assert.equal(r.status,'unavailable');
 }
});
test('two equally close planned neighbours are ambiguous rather than sorted arbitrarily',async()=>{
 const {source,map}=data();
 map.set('before2',t('before2','L12',[base+360,base+480,base+600]));
 const result=await findPlannedHeadways({tripId:'mine',date:day,referenceStopId:'A',source});
 assert.equal(result.ahead,null);
 assert.match(result.reason,/nejednoznačná/);
 assert.equal(result.behind?.tripId,'after');
});
test('a duplicated stop ID in own trip is an unsafe reference point',async()=>{
 const {source,map}=data();
 map.set('mine',t('mine','L12',[base+600,base+720,base+840],['A','B','A']));
 const result=await findPlannedHeadways({tripId:'mine',date:day,referenceStopId:'A',source});
 assert.equal(result.status,'unavailable');
});
test('no available LIVE positions is not a prerequisite for PLAN',async()=>{
 const {source}=data();
 const result=await findPlannedHeadways({tripId:'mine',date:day,referenceStopId:'A',source});
 assert.equal(result.ahead?.scheduledGap,240);
 assert.equal(result.behind?.scheduledGap,300);
});
