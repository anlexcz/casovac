import test from 'node:test';
import assert from 'node:assert/strict';
import {physicalBoardingIds} from '../src/physicalBoardingIds.ts';
import {staticNeighbourBoard} from '../src/staticNeighbourBoard.ts';

const date='2026-11-08';
const registry={
 async getStopMap(){return {TRAM:'P/1',BUS:'P/1',TROLLEY:'P/1',SIDE:'P/2'};},
 async getPlatforms(){return {
  'P/1':['group','A',50,14,'','tram','',['TRAM','BUS','TROLLEY'],''],
  'P/2':['group','B',50,14,'','bus','','',['SIDE'],'']
 };}
};
const rows={TRAM:[{stopId:'TRAM',date,departureSeconds:36000,tripId:'own',routeId:'T',stopSequence:2}],
 BUS:[{stopId:'BUS',date,departureSeconds:36040,tripId:'bus',routeId:'B',stopSequence:3}],
 TROLLEY:[{stopId:'TROLLEY',date,departureSeconds:36100,tripId:'trolley',routeId:'Y',stopSequence:4}],
 SIDE:[{stopId:'SIDE',date,departureSeconds:36030,tripId:'side',routeId:'B',stopSequence:2}]};
const source={...registry,
 async getDepartures(id){return rows[id]??[];},
 async getRoutes(){return {T:['9','','0'],B:['140','','3'],Y:['58','','11']};}
};
test('only PID-confirmed sibling IDs count as shared physical boarding edge',async()=>{
 assert.deepEqual(await physicalBoardingIds('TRAM',registry),['TRAM','BUS','TROLLEY']);
 const board=await staticNeighbourBoard('TRAM',date,36000,source);
 assert.deepEqual(board.physicalStopIds,['TRAM','BUS','TROLLEY']);
 assert.deepEqual(board.departures.map(x=>x.trip.id),['own','bus','trolley']);
 assert.deepEqual(board.departures.map(x=>x.route.type),[0,3,11]);
 assert.deepEqual(board.departures.map(x=>x.stop.id),['TRAM','BUS','TROLLEY']);
});
test('unknown or damaged physical metadata never extends the search',async()=>{
 assert.deepEqual(await physicalBoardingIds('UNKNOWN',registry),['UNKNOWN']);
 const broken={...registry,async getPlatforms(){return {'P/1':['group','A',50,14,'','','','',['BUS'],'']};}};
 assert.deepEqual(await physicalBoardingIds('TRAM',broken),['TRAM']);
});
test('one failed sibling shard cannot silently substitute a neighbouring stop',async()=>{
 const failing={...source,async getDepartures(id){if(id==='BUS')throw Error('broken bucket');return rows[id]??[];}};
 await assert.rejects(staticNeighbourBoard('TRAM',date,36000,failing),/broken bucket/);
});
test('legacy exact-only source remains compatible with synthetic fixtures',async()=>{
 const exact={getDepartures:source.getDepartures,getRoutes:source.getRoutes};
 const result=await staticNeighbourBoard('TRAM',date,36000,exact);
 assert.deepEqual(result.physicalStopIds,['TRAM']);
 assert.deepEqual(result.departures.map(x=>x.trip.id),['own']);
});
