// Keep the persistence format and TTL compatible with existing installations.
export const TOKEN_KEY='casovac:golemio-token:v1';
export const ROUTE_KEY='casovac:last-order:v1';
export const ACTIVE_KEY='casovac:active-order:v1';
export const ACTIVE_TTL=4*60*60*1000;
export const recentTracking=():[string,string]|null=>{try{
 const raw=localStorage.getItem(ACTIVE_KEY);if(!raw)return null;
 const v=JSON.parse(raw) as {line?:string;order?:string;expires?:number};
 if(!v?.expires||v.expires<Date.now()||!/^\d{1,3}$/.test(v.line??'')||!/^\d{1,4}$/.test(v.order??'')){
  localStorage.removeItem(ACTIVE_KEY);return null;
 }
 return [v.line!,v.order!];
 }catch{return null;}};
export const stored=(key:string):string=>{try{return localStorage.getItem(key)??'';}catch{return '';}};
export const save=(key:string,value:string)=>{try{if(value)localStorage.setItem(key,value);else localStorage.removeItem(key);return true;}catch{return false;}};
