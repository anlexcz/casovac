import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {PidStaticEngine,PidStaticError} from '../src/pidStatic.ts';

globalThis.crypto??=webcrypto;
const sha=text=>createHash('sha256').update(text).digest('hex');
const base='/data/pid/v1/';
const routes=JSON.stringify({L9:['9','Linka devět','0','','0','0']});
const stops=JSON.stringify({U1:{n:'Anděl',a:50,o:14,p:'A',l:'0',parent:''}});
const table=JSON.stringify({'routes.json':sha(routes),'stops/gtfs.json':sha(stops)});
const tinyManifest={
 schema:'casovac-pid-v1',generatedAt:'2026-11-08T12:00:00Z',
 referenceDay:'2026-11-08',timezone:'Europe/Prague',
 days:{'2026-11-08':{available:true,trips:1,departures:2,routes:1,platforms:1,buckets:1,blocks:0}},
 counts:{routes:1},format:{},feed:{},
 checksumsFile:'checksums.json',checksumsSha256:sha(table),checksumsCount:2
};
function setup({badMap=false,badRoute=false}={}){
 const stored=new Map();
 const requests=[];
 const responses={
  'manifest.json':JSON.stringify(tinyManifest),
  'checksums.json':badMap?JSON.stringify({'routes.json':'0'.repeat(64)}):table,
  'routes.json':badRoute?'{"L9":["CORRUPT"]}':routes,
  'stops/gtfs.json':stops
 };
 const load=async(input)=>{
  const path=String(input).replace(base,'').split('?')[0];
  requests.push(path);
  return path in responses?new Response(responses[path],{status:200}):new Response('missing',{status:404});
 };
 const store={
  get:async key=>stored.has(key)?structuredClone(stored.get(key)):null,
  put:async(key,value)=>{stored.set(key,structuredClone(value));},
  clear:async()=>{stored.clear();}
 };
 return {load,store,requests,stored};
}
test('small manifest does not fetch 280KB checksum map until first uncached shard',async()=>{
 const {load,store,requests}=setup();
 const engine=new PidStaticEngine(base,load,store);
 const m=await engine.getManifest();
 assert.equal(m.checksumsFile,'checksums.json');
 assert.deepEqual(requests,['manifest.json']);
 assert.ok(JSON.stringify(m).length<2000);
 assert.equal((await engine.getRoutes()).L9[0],'9');
 assert.deepEqual(requests,['manifest.json','routes.json','checksums.json']);
 assert.equal((await engine.getGtfsStops()).U1.n,'Anděl');
 assert.equal(requests.filter(x=>x==='checksums.json').length,1);
});

test('restart reads saved checksum index and cached route without fetching either',async()=>{
 const {load,store,requests}=setup();
 await new PidStaticEngine(base,load,store).getRoutes();
 const afterFirst=requests.length;
 const engine=new PidStaticEngine(base,load,store);
 assert.equal((await engine.getRoutes()).L9[0],'9');
 assert.deepEqual(requests.slice(afterFirst),['manifest.json']);
 await engine.getGtfsStops();
 assert.equal(requests.filter(x=>x==='checksums.json').length,1,
  'stored checksum index must prevent another large request');
});

test('tampered checksum map is rejected before shard is cached',async()=>{
 const {load,store}=setup({badMap:true});
 const engine=new PidStaticEngine(base,load,store);
 await assert.rejects(engine.getRoutes(),
  error=>error instanceof PidStaticError&&error.reason==='invalid'&&/checksum index release mismatch/.test(error.message));
});

test('checksum map is correct, but mismatched individual shard still fails',async()=>{
 const {load,store}=setup({badRoute:true});
 const engine=new PidStaticEngine(base,load,store);
 await assert.rejects(engine.getRoutes(),
  error=>error instanceof PidStaticError&&error.reason==='invalid'&&/release mismatch/.test(error.message));
});

test('unsupported or tampered manifest checksum metadata is not silently accepted',async()=>{
 const {store}=setup();
 const fake={...tinyManifest,checksumsFile:'../secret.json'};
 const loader=async()=>new Response(JSON.stringify(fake),{status:200});
 const engine=new PidStaticEngine(base,loader,store);
 await assert.rejects(engine.getManifest(),
  error=>error instanceof PidStaticError&&error.reason==='invalid');
});
