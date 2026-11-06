import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTIVE_KEY,ACTIVE_TTL,recentTracking,stored,save} from '../src/trackingStorage.ts';

function withStorage(run){
 const old=globalThis.localStorage;
 const values=new Map();
 globalThis.localStorage={
  getItem:(key)=>values.has(key)?values.get(key):null,
  setItem:(key,value)=>{values.set(key,String(value));},
  removeItem:(key)=>{values.delete(key);}
 };
 try{run(values);}finally{if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old;}
}
test('restores unexpired active line/order without extending expiration',()=>{
 withStorage(()=>{
  const expires=Date.now()+ACTIVE_TTL;
  assert.equal(save(ACTIVE_KEY,JSON.stringify({line:'25',order:'5',expires})),true);
  assert.deepEqual(recentTracking(),['25','5']);
  assert.equal(JSON.parse(stored(ACTIVE_KEY)).expires,expires);
 });
});
test('expires stale tracking and rejects invalid identifiers',()=>{
 withStorage((values)=>{
  save(ACTIVE_KEY,JSON.stringify({line:'25',order:'5',expires:Date.now()-1}));
  assert.equal(recentTracking(),null);
  assert.equal(values.has(ACTIVE_KEY),false);
  save(ACTIVE_KEY,JSON.stringify({line:'25/6',order:'5',expires:Date.now()+10000}));
  assert.equal(recentTracking(),null);
 });
});
test('tolerates malformed data and unavailable localStorage',()=>{
 withStorage(()=>{
  save(ACTIVE_KEY,'{invalid');
  assert.equal(recentTracking(),null);
  assert.equal(stored('absent'),'');
  assert.equal(save('key','value'),true);
  assert.equal(save('key',''),true);
  assert.equal(stored('key'),'');
 });
 const original=globalThis.localStorage;
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem(){throw Error('disabled');},
  setItem(){throw Error('disabled');},
  removeItem(){throw Error('disabled');}
 }});
 try{
  assert.equal(stored(ACTIVE_KEY),'');
  assert.equal(save('key','value'),false);
  assert.equal(recentTracking(),null);
 }finally{
  if(original===undefined)delete globalThis.localStorage;
  else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:original});
 }
});
