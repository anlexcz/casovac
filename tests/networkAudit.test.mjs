import test from 'node:test';
import assert from 'node:assert/strict';
import {endpointLabel,recordNetworkEvent,networkAuditReport,clearNetworkAudit,setNetworkAuditScenario} from '../src/networkAudit.ts';

test('audit endpoint masks IDs and sensitive query values',()=>{
 const endpoint=endpointLabel('https://api.golemio.cz/v2/gtfs/trips/25_1234_261101?date=2026-11-08&access_token=secret&stopId=U1234&limit=1000');
 assert.equal(endpoint,'golemio/v2/gtfs/trips/:id?date&limit&stopId');
 assert.ok(!endpoint.includes('secret'));
 assert.ok(!endpoint.includes('261101'));
 assert.ok(!endpoint.includes('U1234'));
});

test('audit does not store token, response body or full URL; reports real HTTP separately',()=>{
 const values=new Map();
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 globalThis.window={sessionStorage:storage,location:{origin:'https://anlexcz.github.io'}};
 clearNetworkAudit();
 setNetworkAuditScenario('tracking-15m');
 const url='https://api.golemio.cz/v2/vehiclepositions?routeShortName=9&access_token=SECRET';
 recordNetworkEvent({source:'golemioClient',url,kind:'cache',ttlMs:30000});
 recordNetworkEvent({source:'golemioClient',url,kind:'coalesced',ttlMs:30000});
 recordNetworkEvent({source:'golemioClient',url,kind:'http',status:200,durationMs:102});
 recordNetworkEvent({source:'golemioClient',url,kind:'http',status:429,durationMs:250});
 const report=networkAuditReport();
 assert.equal(report.scenario,'tracking-15m');
 assert.equal(report.summary[0].http,2);
 assert.equal(report.summary[0].cache,1);
 assert.equal(report.summary[0].coalesced,1);
 assert.equal(report.summary[0].rateLimited,1);
 assert.equal(report.summary[0].meanDurationMs,176);
 assert.ok(!JSON.stringify([...values.values()]).includes('SECRET'));
 assert.equal(report.events.every(event=>event.scenario==='tracking-15m'),true);
 delete globalThis.window;
});
