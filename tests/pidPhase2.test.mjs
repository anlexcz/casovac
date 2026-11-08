import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {runPhase2Scenario,phase2Scenarios} from '../src/pidPhase2Diagnostics.ts';
import {pidServiceDate} from '../src/pidStatic.ts';

globalThis.crypto??=webcrypto;
const today=pidServiceDate(new Date());
const tripId='TEST_001';
const filename=createHash('sha256').update('L9').digest('hex').slice(0,16)+'.json';
const base='/data/pid/v1/';
const manifest={
 schema:'casovac-pid-v1',generatedAt:'2026-11-08T10:00:00Z',referenceDay:today,timezone:'Europe/Prague',
 days:{[today]:{available:true,trips:1,departures:2,routes:1,platforms:2,buckets:1,blocks:0}},
 counts:{uniqueTrips:1},format:{},
 feed:{gtfsUrl:'',stopsUrl:'',startDate:'',endDate:'',stopsGeneratedAt:null}
};
const endpoints={
 'manifest.json':manifest,
 ['days/'+today+'/trips.json']:{[tripId]:['L9',filename]},
 ['days/'+today+'/routes/'+filename]:{
  [tripId]:['A','Řepy','0','','shape','',[
   ['U1',90000,90000,1,'1'],['U2',90600,90600,2,'1']
  ]]
 },
 'stops/gtfs.json':{
  U1:{n:'A',a:50,o:14,p:'A',l:'0',parent:''},
  U2:{n:'B',a:50.1,o:14.1,p:'B',l:'0',parent:''}
 },
 'stops/gtfs-map.json':{U1:'10/1',U2:'10/2'}
};
const disk=new Map();
const store={
 get:async key=>structuredClone(disk.get(key)??null),
 put:async(key,value)=>{disk.set(key,structuredClone(value));},
 clear:async()=>disk.clear()
};
let requested=[];
const fetcher=async input=>{
 const path=String(input).slice(base.length).split('?')[0];
 requested.push(path);
 if(!(path in endpoints))return new Response('missing',{status:404});
 return new Response(JSON.stringify(endpoints[path]),{
  status:200,headers:{'Content-Type':'application/json'}
 });
};

test('guided phase 2 diagnostics pass for real storage reuse and controlled simulations',async()=>{
 for(const scenario of phase2Scenarios){
  const result=await runPhase2Scenario(scenario.id,today,tripId,{base,store,fetcher});
  assert.equal(result.status,'pass',scenario.title+' failed: '+result.error);
  assert.equal(result.id,scenario.id);
  assert.ok(result.durationMs>=0);
 }
 const offline=await runPhase2Scenario('offline',today,tripId,{base,store,fetcher});
 assert.equal(offline.status,'pass');
 assert.match(offline.detail,/persisted/);
 assert.ok(requested.includes('manifest.json'));
});

test('guided diagnostics report a missing trip as FAIL, not a silent PASS',async()=>{
 const result=await runPhase2Scenario('load',today,'UNKNOWN',{base,store,fetcher});
 assert.equal(result.status,'fail');
 assert.ok(result.error);
});
