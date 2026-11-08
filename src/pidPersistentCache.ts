/** Best-effort persistent PID shard cache. No Golemio tokens or personal data.
 * IndexedDB failures (private mode, quotas, blocked storage) must never block live use.
 */
export type PidCacheInfo={available:boolean;entries:number;bytes:number;limitBytes:number;entryLimit:number;largestBytes:number;manifestSaved:boolean};
export interface PidStore{
 get(key:string):Promise<unknown|null>;
 put(key:string,value:unknown):Promise<void>;
 clear():Promise<void>;
}
type Entry={key:string;value:unknown;size:number;accessed:number};
const MAX_BYTES=32*1024*1024;
const MAX_ENTRIES=90;
const MAX_ITEM=5*1024*1024;
const DB_NAME='casovac-pid-static-v1';
const STORE='entries';
export class IndexedPidStore implements PidStore{
 private connection:Promise<IDBDatabase|null>|null=null;
 private open():Promise<IDBDatabase|null>{
  if(this.connection)return this.connection;
  this.connection=new Promise(resolve=>{
   if(typeof indexedDB==='undefined'){resolve(null);return;}
   try{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
     if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'key'});
    };
    request.onsuccess=()=>{
     const db=request.result;
     db.onversionchange=()=>{db.close();this.connection=null;};
     resolve(db);
    };
    request.onerror=()=>resolve(null);
    request.onblocked=()=>resolve(null);
   }catch{resolve(null);}
  });
  return this.connection;
 }
 async get(key:string):Promise<unknown|null>{
  const db=await this.open();if(!db)return null;
  return new Promise(resolve=>{
   try{
    const tx=db.transaction(STORE,'readonly');
    const req=tx.objectStore(STORE).get(key);
    req.onsuccess=()=>resolve((req.result as Entry|undefined)?.value??null);
    req.onerror=()=>resolve(null);
    tx.onabort=()=>resolve(null);
   }catch{resolve(null);}
  });
 }
 async put(key:string,value:unknown):Promise<void>{
  const db=await this.open();if(!db)return;
  let size:number;
  try{size=new Blob([JSON.stringify(value)]).size;}catch{return;}
  if(size>MAX_ITEM)return;
  await new Promise<void>(resolve=>{
   try{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({key,value,size,accessed:Date.now()} satisfies Entry);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>resolve();
    tx.onabort=()=>resolve();
   }catch{resolve();}
  });
  // Best effort LRU bounds: no download blocks on cleanup failures.
  await this.prune(db);
 }
 private async prune(db:IDBDatabase):Promise<void>{
  const records=await new Promise<Entry[]>(resolve=>{
   try{
    const tx=db.transaction(STORE,'readonly');
    const request=tx.objectStore(STORE).getAll();
    request.onsuccess=()=>resolve(request.result as Entry[]);
    request.onerror=()=>resolve([]);
    tx.onabort=()=>resolve([]);
   }catch{resolve([]);}
  });
  let total=records.reduce((sum,item)=>sum+item.size,0);
  let count=records.length;
  if(total<=MAX_BYTES&&count<=MAX_ENTRIES)return;
  const ordered=records.filter(item=>item.key!=='manifest')
   .sort((a,b)=>a.accessed-b.accessed);
  const remove:string[]=[];
  for(const item of ordered){
   if(total<=MAX_BYTES&&count<=MAX_ENTRIES)break;
   total-=item.size;count--;remove.push(item.key);
  }
  if(!remove.length)return;
  await new Promise<void>(resolve=>{
   try{
    const tx=db.transaction(STORE,'readwrite');
    const store=tx.objectStore(STORE);
    for(const key of remove)store.delete(key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>resolve();
    tx.onabort=()=>resolve();
   }catch{resolve();}
  });
 }
 async inspect():Promise<PidCacheInfo>{
  const empty:PidCacheInfo={available:false,entries:0,bytes:0,limitBytes:MAX_BYTES,
   entryLimit:MAX_ENTRIES,largestBytes:0,manifestSaved:false};
  const db=await this.open();if(!db)return empty;
  return new Promise(resolve=>{
   try{
    const tx=db.transaction(STORE,'readonly');
    const req=tx.objectStore(STORE).getAll();
    req.onsuccess=()=>{
     const entries=req.result as Entry[];
     resolve({available:true,entries:entries.length,
      bytes:entries.reduce((sum,item)=>sum+item.size,0),
      limitBytes:MAX_BYTES,entryLimit:MAX_ENTRIES,
      largestBytes:entries.reduce((max,item)=>Math.max(max,item.size),0),
      manifestSaved:entries.some(item=>item.key==='manifest')});
    };
    req.onerror=()=>resolve(empty);
    tx.onabort=()=>resolve(empty);
   }catch{resolve(empty);}
  });
 }
 async clear():Promise<void>{
  const db=await this.open();if(!db)return;
  await new Promise<void>(resolve=>{
   try{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
   }catch{resolve();}
  });
 }
}
