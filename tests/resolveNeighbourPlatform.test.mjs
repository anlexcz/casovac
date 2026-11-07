import test from 'node:test';
import assert from 'node:assert/strict';
import {departureBoardNameUrl,resolveOwnPlatform} from '../src/resolveNeighbourPlatform.ts';

function depart(id,stopId,scheduled){
 return {trip:{id},route:{short_name:'7',type:0},
  stop:{id:stopId},arrival_timestamp:{scheduled},departure_timestamp:{scheduled},
  delay:{is_available:false,seconds:null}};
}
test('name lookup queries the stop only to discover our exact trip platform',()=>{
 const url=new URL(departureBoardNameUrl('Želivského'));
 assert.equal(url.searchParams.get('names'),'Želivského');
 assert.equal(url.searchParams.has('ids[]'),false);
 assert.equal(url.searchParams.get('minutesAfter'),'120');
});
test('matching own trip and time resolves one authoritative boarding edge',()=>{
 const data={departures:[
  depart('other','U123Z1P','2026-11-07T10:32:00+01:00'),
  depart('7_19838_261107','U123Z2P','2026-11-07T10:32:00+01:00')
 ]};
 const found=resolveOwnPlatform(data,'7_19838_261107','10:32:00');
 assert.equal(found.id,'U123Z2P');
 assert.equal(found.matches,1);
});
test('other trips, conflicting edges and mismatched times never resolve',()=>{
 const wrong={departures:[depart('other','U1','2026-11-07T10:32:00+01:00')]};
 assert.equal(resolveOwnPlatform(wrong,'own','10:32').id,'');
 const mismatch={departures:[depart('own','U1','2026-11-07T10:40:00+01:00')]};
 assert.equal(resolveOwnPlatform(mismatch,'own','10:32').id,'');
 const ambiguous={departures:[
  depart('own','U1','2026-11-07T10:32:00+01:00'),
  depart('own','U2','2026-11-07T10:32:00+01:00')
 ]};
 assert.equal(resolveOwnPlatform(ambiguous,'own','10:32').id,'');
});
test('stop resolution accepts GTFS service hour 24 with clock time after midnight',()=>{
 const data={departures:[depart('own','U1','2026-11-08T00:12:00+01:00')]};
 assert.equal(resolveOwnPlatform(data,'own','24:12:00').id,'U1');
});
