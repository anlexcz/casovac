import test from 'node:test';
import assert from 'node:assert/strict';
import {getStaticHeadwayDetail,getStaticHeadwayChain} from '../src/headwayStatic.ts';
import {parseStops} from '../src/tripData.ts';

const day='2026-11-08';
const t=(i,route,block='B')=>({
 id:'T'+i,date:day,routeId:'L'+route,serviceId:'A',
 headsign:'Vozovna',directionId:'0',blockId:block,shapeId:'s',shortName:'',
 stopTimes:[['S'+i,85000+i*900,85000+i*900,1,'A'],
  ['S'+(i+1),85600+i*900,85600+i*900,2,'A']]
});
const trips=[t(0,'12'),t(1,'17'),t(2,'24')];
const hhmmss=v=>[Math.floor(v/3600),Math.floor(v%3600/60),v%60]
 .map(n=>String(n).padStart(2,'0')).join(':');
const rows=trip=>trip.stopTimes.map(([id,a,d,seq])=>({
 id,name:'Zastávka '+id,arrival:hhmmss(a),departure:hhmmss(d),
 sequence:seq,lat:50+seq/1000,lon:14+seq/1000,
 platformCode:'A',physicalId:id
}));
const makeSource=(changes={})=>{
 const data=new Map(trips.map(trip=>[trip.id,trip]));
 const stops=new Map(trips.map(trip=>[trip.id,rows(trip)]));
 const routeRows={L12:['12','','','','',''],L17:['17','','','','',''],
  L24:['24','','','','','']};
 const counters={getTrip:0,getTripResolved:0,getTripStops:0,getBlockTrips:0,getRoutes:0};
 const source={
  async getTripResolved(id,date){counters.getTripResolved++;return date===day?data.get(id)??null:null;},
  async getTrip(id,date){counters.getTrip++;return date===day?data.get(id)??null:null;},
  async getTripStops(id){counters.getTripStops++;return stops.get(id)??null;},
  async getBlockTrips(block,date){counters.getBlockTrips++;
   return block==='B'&&date===day?trips.map(x=>({
    id:x.id,date,routeId:x.routeId,startSeconds:x.stopTimes[0][2]})):[];},
  async getRoutes(){counters.getRoutes++;return routeRows;}
 };
 return {source,counters,data,stops,...changes};
};

test('headway static detail preserves real stop IDs, 24+ hours and lines',async()=>{
 const {source,counters}=makeSource();
 const detail=await getStaticHeadwayDetail('T0',day,source);
 assert.equal(detail.trip_id,'T0');
 assert.equal(detail.route.route_short_name,'12');
 assert.equal(detail.pidStatic,true);
 assert.deepEqual(parseStops(detail).map(s=>s.id),['S0','S1']);
 assert.equal(parseStops(detail)[0].arrival,'23:36:40');
 assert.equal(parseStops(detail)[1].arrival,'23:46:40');
 assert.equal(counters.getTripResolved,1);
 assert.equal(await getStaticHeadwayDetail('T0','2026-11-09',source),null);
});

test('generic chain produces joined timetable with exact link index',async()=>{
 const {source}=makeSource();
 const first=await getStaticHeadwayChain('T0','12',day,source);
 assert.deepEqual(first.lines,['17']);
 assert.equal(first.stops.length,3);
 assert.deepEqual(first.stops.map(s=>s.id),['S0','S1','S2']);
 assert.deepEqual(first.link,{
  firstId:'T0',secondId:'T1',firstLine:'12',secondLine:'17',boundaryIndex:1
 });
 const middle=await getStaticHeadwayChain('T1','17',day,source);
 assert.deepEqual(middle.lines,['12','24']);
 assert.equal(middle.link.firstId,'T1');
 assert.equal(middle.link.secondId,'T2');
 const last=await getStaticHeadwayChain('T2','24',day,source);
 assert.deepEqual(last.lines,['17']);
 assert.equal(last.link.firstId,'T1');
 assert.equal(last.link.secondId,'T2');
});

test('missing or incomplete static stop data rejects false headway schedule',async()=>{
 const {source,stops}=makeSource();
 stops.set('T0',[{...rows(trips[0])[0],id:''},rows(trips[0])[1]]);
 assert.equal(await getStaticHeadwayDetail('T0',day,source),null);
 assert.equal(await getStaticHeadwayChain('T0','12',day,source),null);
});

test('same-route block leg does not produce cross-route link by skipping',async()=>{
 const {source,data}=makeSource();
 data.set('T1',{...trips[1],routeId:'L12'});
 const rows=await source.getRoutes();
 rows.L17=['17','','','','',''];
 const original=source.getBlockTrips;
 source.getBlockTrips=async(block,date)=>{
  const items=await original(block,date);
  return items.map(item=>item.id==='T1'?{...item,routeId:'L12'}:item);
 };
 const res=await getStaticHeadwayChain('T0','12',day,source);
 assert.equal(res.link,null);
 assert.deepEqual(res.lines,[]);
});

test('reversed route or wrong service day cannot create a headway link',async()=>{
 const {source}=makeSource();
 assert.equal(await getStaticHeadwayChain('T0','24',day,source),null);
 assert.equal(await getStaticHeadwayChain('T0','12','2026-11-09',source),null);
});
