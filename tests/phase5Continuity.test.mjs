import test from 'node:test';
import assert from 'node:assert/strict';
import {peerDutyCandidates} from '../src/peerDutyContinuity.ts';
import {staticNeighbourBoard,STATIC_LOOKBACK_SECONDS} from '../src/staticNeighbourBoard.ts';
import {parseNeighbourBoard} from '../src/stopNeighbourBoard.ts';
import {DEFAULT_NEIGHBOUR_SETTINGS} from '../src/stopNeighbours.ts';

const day='2026-11-08';
const stop=(id,name,arrival,departure,sequence)=>({
 id,name,arrival,departure,sequence,lat:50,lon:14,platformCode:'',physicalId:null
});
const one=[
 stop('A','Předchozí','14:00:00','14:00:00',1),
 stop('B','Přestup','14:10:00','14:10:30',2)
];
const two=[
 stop('B','Přestup','14:11:00','14:11:00',1),
 stop('C','Následující','14:20:00','14:20:00',2)
];
const routes={r5:['5','','0','','',''],r6:['6','','0','','','']};
const trip=(id,routeId)=>({
 id,date:day,routeId,blockId:'BLOCK',serviceId:'',headsign:'',
 directionId:'',shapeId:'',shortName:'',stopTimes:[['A',50400,50400,1]]
});
const own={tripId:'trip5',line:'5',order:'',scheduledGap:60,
 departureSeconds:14*3600,referenceStopId:'A'};
const source={
 getTripResolved:async id=>id==='trip5'?trip('trip5','r5'):
  id==='trip6'?trip('trip6','r6'):null,
 getBlockTrips:async()=>[
  {id:'trip5',routeId:'r5',date:day,startSeconds:14*3600},
  {id:'trip6',routeId:'r6',date:day,startSeconds:14*3600+11*60}
 ],
 getTripStops:async id=>id==='trip5'?one:two,
 getRoutes:async()=>routes
};
test('a delayed LIVE peer keeps its planned identity across an exact GTFS block handoff',async()=>{
 const now=Date.parse('2026-11-08T13:16:00Z'); // 14:16 Prague
 assert.deepEqual((await peerDutyCandidates(own,day,now,source)).map(x=>x.tripId),
  ['trip5','trip6']);
});
test('a wrong terminal or wrong block forbids successor substitution',async()=>{
 const altered={...source,getTripStops:async id=>
  id==='trip5'?one:[stop('X','Jiná','14:11:00','14:11:00',1),two[1]]};
 assert.deepEqual((await peerDutyCandidates(own,day,Date.parse('2026-11-08T13:16:00Z'),altered))
  .map(x=>x.tripId),['trip5']);
});
test('never skip an intermediary block trip to reach a later successor',async()=>{
 const altered={...source,getBlockTrips:async()=>[
  {id:'trip5',routeId:'r5',date:day,startSeconds:14*3600},
  {id:'unknown',routeId:'r5',date:day,startSeconds:14*3600+5*60},
  {id:'trip6',routeId:'r6',date:day,startSeconds:14*3600+11*60}
 ]};
 assert.deepEqual((await peerDutyCandidates(own,day,Date.parse('2026-11-08T13:16:00Z'),altered))
  .map(x=>x.tripId),['trip5']);
});
test('GTFS board includes a tram 30 minutes behind the schedule',async()=>{
 const base=15*3600;
 const fixture={
  getDepartures:async()=>[
   {tripId:'late',stopId:'S',date:day,routeId:'r5',stopSequence:4,
    departureSeconds:base-30*60},
   {tripId:'near',stopId:'S',date:day,routeId:'r5',stopSequence:5,
    departureSeconds:base+60},
   {tripId:'old',stopId:'S',date:day,routeId:'r5',stopSequence:6,
    departureSeconds:base-STATIC_LOOKBACK_SECONDS-1},
   {tripId:'bus',stopId:'S',date:day,routeId:'bus',stopSequence:7,
    departureSeconds:base}
  ],
  getRoutes:async()=>({...routes,bus:['100','','3','','','']})
 };
 const board=await staticNeighbourBoard('S',day,base,fixture);
 assert.deepEqual(board.departures.map(x=>x.trip.id),['late','near','bus']);
 assert.equal(board.departures[0].scheduledSeconds,base-1800);
});

test('a peer scheduled 30 minutes early is displayed if fresh LIVE makes ETA equal to own time',()=>{
 const now=Date.parse('2026-11-08T14:00:00Z'); // 15:00 Prague
 const board={departures:[{trip:{id:'late'},route:{short_name:'5',type:0},
  stop:{id:'S'},stopSequence:4,scheduledSeconds:14*3600+30*60}]};
 const stop={id:'S',name:'Zastávka',sequence:4,arrival:'15:00:00',departure:'15:00:00',
  lat:50,lon:14};
 const feature={properties:{trip:{gtfs:{trip_id:'late',route_short_name:'5'},
  vehicle_registration_number:'9376',sequence_id:'10'},
  last_position:{origin_timestamp:new Date(now-1000).toISOString(),
   state_position:'on_track',next_stop:{sequence:3},
   delay:{actual:1800}}}};
 const args={board,stop,ownTripId:'own',ownStops:[stop],ownIndex:0,
  ownDelay:0,settings:DEFAULT_NEIGHBOUR_SETTINGS,distance:0,
  features:[feature],now};
 const res=parseNeighbourBoard(args);
 assert.equal(res.rows.length,1);
 assert.equal(res.rows[0].predictedDifference,0);
 assert.equal(res.rows[0].vehicle,'9376');
 assert.equal(parseNeighbourBoard({...args,features:[]}).rows.length,0);
});
test('a LIVE tram that passed the platform is not an approaching conflict',()=>{
 const now=Date.parse('2026-11-08T14:00:00Z');
 const stop={id:'S',name:'Zastávka',sequence:4,arrival:'15:00:00',
  departure:'15:00:00',lat:50,lon:14};
 const feature={properties:{trip:{gtfs:{trip_id:'late',route_short_name:'5'},
  vehicle_registration_number:'9376'},last_position:{
  origin_timestamp:new Date(now-1000).toISOString(),state_position:'on_track',
  next_stop:{sequence:5},delay:{actual:1800}}}};
 const board={departures:[{trip:{id:'late'},route:{short_name:'5',type:0},
  stop:{id:'S'},scheduledSeconds:14*3600+30*60,stopSequence:4}]};
 assert.equal(parseNeighbourBoard({board,stop,ownTripId:'own',ownStops:[stop],
  ownIndex:0,ownDelay:0,settings:DEFAULT_NEIGHBOUR_SETTINGS,distance:0,
  features:[feature],now}).rows.length,0);
});
