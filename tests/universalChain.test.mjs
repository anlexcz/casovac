import test from 'node:test';
import assert from 'node:assert/strict';
import {findStaticBlockPair,findStaticBlockLinks} from '../src/staticBlockPair.ts';

const day='2026-11-08';
const stamp=seconds=>{
 const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
 return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
};
function createBlock(lines,opts={}){
 const tripMap=new Map(),stopMap=new Map();
 const starts=[];
 const routes={};
 lines.forEach((line,i)=>{
  const id='trip-'+i,routeId='L'+line;
  const start=84000+i*900,end=start+600;
  starts.push({id,routeId,startSeconds:start});
  routes[routeId]=[line,'','0','','',''];
  const begin='stop-'+i,finish='stop-'+(i+1);
  tripMap.set(id,{id,date:day,routeId,blockId:'B',serviceId:'A',
   headsign:'Cíl',directionId:'0',shapeId:'s',shortName:'',
   stopTimes:[[begin,start,start,1,'1'],[finish,end,end,2,'1']]});
  stopMap.set(id,[
   {id:begin,name:'Konečná '+i,sequence:1,arrival:stamp(start),departure:stamp(start),
    lat:50+i*.001,lon:14+i*.001,platformCode:'A',physicalId:begin},
   {id:finish,name:'Konečná '+(i+1),sequence:2,arrival:stamp(end),departure:stamp(end),
    lat:50+(i+1)*.001,lon:14+(i+1)*.001,platformCode:'A',physicalId:finish}
  ]);
 });
 const source={
  getTrip:async id=>tripMap.get(id)??null,
  getTripStops:async id=>stopMap.get(id)??null,
  getBlockTrips:async()=>opts.index??starts,
  getRoutes:async()=>routes
 };
 return {source,tripMap,stopMap,starts};
}

test('universal resolver identifies arbitrary routes 12 → 17 → 24 with both neighbours',async()=>{
 const {source}=createBlock(['12','17','24']);
 const first=await findStaticBlockLinks('trip-0','12',day,source);
 assert.equal(first.next?.partner.line,'17');
 assert.equal(first.previous,null);
 const middle=await findStaticBlockLinks('trip-1','17',day,source);
 assert.equal(middle.previous?.partner.line,'12');
 assert.equal(middle.next?.partner.line,'24');
 assert.equal((await findStaticBlockPair('trip-1','17',day,source))?.partner.line,'24');
 const last=await findStaticBlockLinks('trip-2','24',day,source);
 assert.equal(last.previous?.partner.line,'17');
 assert.equal(last.next,null);
});

test('repeated route number still preserves distinct trip identity',async()=>{
 const {source}=createBlock(['12','17','12']);
 const middle=await findStaticBlockLinks('trip-1','17',day,source);
 assert.equal(middle.previous?.partner.tripId,'trip-0');
 assert.equal(middle.next?.partner.tripId,'trip-2');
 assert.equal(middle.previous.partner.line,middle.next.partner.line);
});

test('same-line intervening trip must never be skipped',async()=>{
 const {source}=createBlock(['12','12','24']);
 const first=await findStaticBlockLinks('trip-0','12',day,source);
 assert.equal(first.next,null);
 const middle=await findStaticBlockLinks('trip-1','12',day,source);
 assert.equal(middle.previous,null);
 assert.equal(middle.next.partner.line,'24');
});

test('all-day blocks with 25 trips have no fixed two-route or sixteen-trip limit',async()=>{
 const lines=Array.from({length:25},(_,i)=>String(1+i%24));
 const {source}=createBlock(lines);
 const middle=await findStaticBlockLinks('trip-12',lines[12],day,source);
 assert.equal(middle.previous?.partner.tripId,'trip-11');
 assert.equal(middle.next?.partner.tripId,'trip-13');
});

test('ties in GTFS start times must not create arbitrary route handoffs',async()=>{
 const {source,starts}=createBlock(['12','17','24']);
 const indexed=[starts[0],{...starts[1],startSeconds:starts[2].startSeconds},starts[2]];
 source.getBlockTrips=async()=>indexed;
 assert.deepEqual(await findStaticBlockLinks('trip-0','12',day,source),{previous:null,next:null});
});

test('a missing adjacent trip does not permit linking to the following trip',async()=>{
 const {source,tripMap}=createBlock(['12','17','24']);
 tripMap.delete('trip-1');
 assert.equal((await findStaticBlockLinks('trip-0','12',day,source)).next,null);
});

test('one GTFS block is not permission to link across different service days',async()=>{
 const {source}=createBlock(['7','13']);
 assert.deepEqual(await findStaticBlockLinks('trip-0','7','2026-11-09',source),
  {previous:null,next:null});
});
