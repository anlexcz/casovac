import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {PidStaticEngine,PidStaticError,comparePidTripStops,formatGtfsSeconds,pidTripStopRows} from '../src/pidStatic.ts';

globalThis.crypto??=webcrypto;
const hash=name=>createHash('sha256').update(name).digest('hex').slice(0,16)+'.json';
const bucket=id=>String(createHash('sha256').update(id).digest()[0]%64).padStart(2,'0');
const base='/data/pid/v1/';
const day='2026-11-08',route='L9',filename=hash(route);
const manifest=(generatedAt='2026-11-08T09:00:00Z')=>({
 schema:'casovac-pid-v1',generatedAt,referenceDay:day,timezone:'Europe/Prague',
 days:{[day]:{available:true,trips:2,departures:3,routes:1,platforms:2,buckets:2,blocks:1}},
 counts:{uniqueTrips:2},feed:{gtfsUrl:'',stopsUrl:'',startDate:'',endDate:'',stopsGeneratedAt:null}
});
const sources={
 'manifest.json':manifest(),
 'routes.json':{L9:['9','','0','','0','0']},
 'stops/gtfs.json':{
  U1:{n:'Anděl',a:50,o:14,p:'A',l:'0',parent:''},
  U2:{n:'Arbesovo náměstí',a:50.1,o:14.1,p:'B',l:'0',parent:''}
 },
 'stops/gtfs-map.json':{U1:'1040/1',U2:'4/2'},
 'stops/platforms.json':{'1040/1':['1040-a','A',50,14,'P','tram','possible',['U1'],'Anděl']},
 ['days/'+day+'/trips.json']:{T9:[route,filename],T10:[route,filename]},
 ['days/'+day+'/routes/'+filename]:{
  T9:['service','Řepy','0','B9','shape','',[
   ['U1',86100,86160,1,'1'],['U2',86820,86820,2,'1']]],
  T10:['service','Řepy','0','B9','shape','',[
   ['U2',87300,87360,1,'1']]]},
 ['days/'+day+'/blocks.json']:{B9:[[86100,'T9',route],[87300,'T10',route]]},
 ['shapes/'+filename]:{shape:[[50,14],[50.1,14.1]]},
};
for(const id of ['U1','U2'])sources['days/'+day+'/departures/'+bucket(id)+'.json']??={};
sources['days/'+day+'/departures/'+bucket('U1')+'.json'].U1=[[86160,'T9','L9',1]];
sources['days/'+day+'/departures/'+bucket('U2')+'.json'].U2=[[86820,'T9','L9',2],[87360,'T10','L9',1]];

function setup(){
 const count=new Map();
 const mock=async input=>{
  const uri=String(input);
  const key=uri.startsWith(base)?uri.slice(base.length).split('?')[0]:null;
  if(!key)throw new Error('unexpected '+uri);
  count.set(key,(count.get(key)??0)+1);
  if(!Object.hasOwn(sources,key))return {ok:false,status:404};
  return {ok:true,status:200,json:async()=>structuredClone(sources[key])};
 };
 return {engine:new PidStaticEngine(base,mock),count};
}
test('GTFS 24:xx is preserved and comparison does not invent a live delay',()=>{
 assert.equal(formatGtfsSeconds(90000),'25:00:00');
 const trip={id:'T9',stopTimes:[['U1',86100,86160,1,'1']]};
 const rows=pidTripStopRows(trip,{U1:sources['stops/gtfs.json'].U1});
 assert.equal(rows[0].arrival,'23:55:00');
 assert.equal(comparePidTripStops(rows,[{id:'U1',sequence:1,arrival:'23:55',departure:'23:56'}]).match,true);
 assert.equal(comparePidTripStops(rows,[{id:'U2',sequence:1,arrival:'23:55',departure:'23:56'}]).mismatches[0].reason,'stop-id');
 assert.equal(comparePidTripStops(rows,[]).match,false);
});
test('lookup trip, departures, blocks, stops and shape without Golemio',async()=>{
 const {engine,count}=setup();
 const trip=await engine.getTrip('T9',day);
 assert.equal(trip.routeId,'L9');
 assert.equal(trip.stopTimes[1][1],86820);
 const stops=await engine.getTripStops('T9',day);
 assert.equal(stops[1].name,'Arbesovo náměstí');
 assert.equal(stops[0].physicalId,'1040/1');
 assert.equal(stops[1].physicalId,'4/2');
 const physical=await engine.getPhysicalPlatform('U1');
 assert.equal(physical.id,'1040/1');
 const board=await engine.getDepartures('U2',day);
 assert.deepEqual(board.map(x=>x.tripId),['T9','T10']);
 const block=await engine.getBlockTrips('B9',day);
 assert.deepEqual(block.map(x=>x.id),['T9','T10']);
 const shape=await engine.getRouteShape('L9','shape');
 assert.equal(shape.length,2);
 const same=await Promise.all([engine.getTrip('T9',day),engine.getTrip('T10',day)]);
 assert.equal(same[0].id,'T9');
 assert.equal(count.get('days/'+day+'/routes/'+filename),1);
 assert.equal(await engine.getTrip('missing',day),null);
});
test('service-day boundary and unavailable day do not silently fall back',async()=>{
 const {engine}=setup();
 await assert.rejects(engine.getTrip('T9','2026-11-10'),e=>e instanceof PidStaticError&&e.reason==='unavailable');
 await assert.rejects(engine.getDepartures('U1','today'),e=>e instanceof PidStaticError&&e.reason==='invalid');
});
test('manifest refresh invalidates cached versioned shards',async()=>{
 const {engine,count}=setup();
 await engine.getRoutes();
 await engine.getRoutes();
 assert.equal(count.get('routes.json'),1);
 sources['manifest.json']=manifest('2026-11-08T10:00:00Z');
 await engine.getManifest(true);
 await engine.getRoutes();
 assert.equal(count.get('routes.json'),2);
 sources['manifest.json']=manifest();
});

test('default fetch retains browser receiver (Illegal invocation regression)',async()=>{
 const original=globalThis.fetch;
 const expected={calls:0,fetch:async function(url){
  assert.equal(this,expected,'fetch must retain its browser/global receiver');
  this.calls++;
  assert.match(String(url),/manifest\\.json$/);
  return {ok:true,status:200,json:async()=>manifest()};
 }};
 try{
  globalThis.fetch=expected.fetch.bind(expected);
  // Browser fetch can be a receiver-sensitive method. We additionally check
  // that the default loader never calls a detached original function.
  const engine=new PidStaticEngine(base);
  const data=await engine.getManifest();
  assert.equal(data.schema,'casovac-pid-v1');
  assert.equal(expected.calls,1);
 }finally{globalThis.fetch=original;}
});
