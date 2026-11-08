import test from 'node:test';
import assert from 'node:assert/strict';
import {findStaticBlockPair} from '../src/staticBlockPair.ts';

const stop=(id,name,sequence,arrival,departure,lat,lon)=>({
 id,name,sequence,arrival,departure,lat,lon,platformCode:'A',physicalId:id
});
const common={
 date:'2026-11-08',serviceId:'A',directionId:'0',shapeId:'s',
 shortName:'',headsign:'Směr'
};
const trips={
 t9:{...common,id:'t9',routeId:'L9',blockId:'B9',
  stopTimes:[['U1',85000,85000,1,'1'],['U2',86000,86000,2,'1']]},
 t10:{...common,id:'t10',routeId:'L10',blockId:'B9',
  stopTimes:[['U2',86600,86600,1,'1'],['U3',88000,88000,2,'1']]},
 bad:{...common,id:'bad',routeId:'L6',blockId:'OTHER',
  stopTimes:[['U2',86500,86500,1,'1'],['U4',87000,87000,2,'1']]},
 t5:{...common,id:'t5',routeId:'L5',blockId:'B5',
  stopTimes:[['U1',85000,85000,1,'1'],['U2',86000,86000,2,'1']]},
 t6:{...common,id:'t6',routeId:'L6',blockId:'B5',
  stopTimes:[['U2',86600,86600,1,'1'],['U3',88000,88000,2,'1']]}
};
const positions={
 t9:[stop('U1','Anděl',1,'23:36:40','23:36:40',50,14),stop('U2','Ústřední dílny',2,'23:53:20','23:53:20',50.1,14.1)],
 t10:[stop('U2','Ústřední dílny',1,'24:03:20','24:03:20',50.1,14.1),stop('U3','Vozovna',2,'24:26:40','24:26:40',50.2,14.2)],
 t5:[stop('U1','Anděl',1,'23:36:40','23:36:40',50,14),stop('U2','Ústřední dílny',2,'23:53:20','23:53:20',50.1,14.1)],
 t6:[stop('U2','Ústřední dílny',1,'24:03:20','24:03:20',50.1,14.1),stop('U3','Vozovna',2,'24:26:40','24:26:40',50.2,14.2)]
};
function fixture(extra=[]){
 const requests=[];
 return {
  requests,
  source:{
   getTrip:async id=>{requests.push('trip:'+id);return trips[id]??null;},
   getTripStops:async id=>{requests.push('stops:'+id);return positions[id]??null;},
   getBlockTrips:async block=>{
    requests.push('block:'+block);
    if(block==='B9')return [{id:'t9',routeId:'L9',startSeconds:85000},
     {id:'t10',routeId:'L10',startSeconds:86600},...extra];
    if(block==='B5')return [{id:'t5',routeId:'L5',startSeconds:85000},
     {id:'t6',routeId:'L6',startSeconds:86600}];
    return [];
   },
   getRoutes:async()=>({L9:['9','','0','','',''],L10:['10','','0','','',''],
    L5:['5','','0','','',''],L6:['6','','0','','','']})
  }
 };
}
test('local 9+10 chain finds both directions without Golemio',async()=>{
 const {source,requests}=fixture();
 const forward=await findStaticBlockPair('t9','9','2026-11-08',source);
 assert.equal(forward.role,'first');
 assert.equal(forward.partner.tripId,'t10');
 assert.equal(forward.partner.line,'10');
 assert.equal(forward.blockId,'B9');
 const reverse=await findStaticBlockPair('t10','10','2026-11-08',source);
 assert.equal(reverse.role,'second');
 assert.equal(reverse.partner.tripId,'t9');
 assert.equal(reverse.partner.line,'9');
 assert.ok(requests.every(x=>!x.includes('golemio')));
});
test('local 5+6 chain preserves shared stop and GTFS clock beyond 24',async()=>{
 const {source}=fixture();
 const pair=await findStaticBlockPair('t5','5','2026-11-08',source);
 assert.equal(pair.partner.tripId,'t6');
 assert.equal(pair.reason.includes('lokálního PID GTFS'),true);
});
test('missing block, wrong selected route and wrong block identity never form a pair',async()=>{
 const {source}=fixture();
 assert.equal(await findStaticBlockPair('bad','6','2026-11-08',source),null);
 assert.equal(await findStaticBlockPair('t9','10','2026-11-08',source),null);
 assert.equal(await findStaticBlockPair('t9','9','not-a-date',source),null);
});
test('ambiguous second same-block successor is refused, not guessed',async()=>{
 const {source}=fixture([{id:'t6',routeId:'L6',startSeconds:86600}]);
 const trip=trips.t6;
 const original=source.getTrip;
 source.getTrip=async(id)=>id==='t6'?{...trip,blockId:'B9'}:original(id);
 assert.equal(await findStaticBlockPair('t9','9','2026-11-08',source),null);
});
test('incomplete geometry-independent stop identities cannot prove a boundary',async()=>{
 const {source}=fixture();
 const original=source.getTripStops;
 source.getTripStops=async id=>id==='t10'?
  [{...positions.t10[0],id:'',name:''},positions.t10[1]]:original(id);
 assert.equal(await findStaticBlockPair('t9','9','2026-11-08',source),null);
});
