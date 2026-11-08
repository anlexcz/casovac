/** Human-readable status of the common-platform board.
 * Do not infer that an unseen severely delayed service cannot exist.
 */
export type BoardNotice={kind:'loading'|'error'|'timetable'|'partial'|'none'|'live';text:string;detail:string};
export function neighbourBoardNotice(input:{
 ready:boolean;loading:boolean;error:string;rows:number;
 ownLive:boolean;verifiedPeers:number;liveIncomplete:boolean;
}):BoardNotice{
 const {ready,loading,error,rows,ownLive,verifiedPeers,liveIncomplete}=input;
 if(!ready){
  if(error)return {kind:'error',text:'Odjezdy se nepodařilo načíst',detail:'Zkus znovu otevřít zastávku nebo obnovit data.'};
  return {kind:'loading',text:'Načítám okolní odjezdy…',detail:'Připravuji jízdní řád a aktuální polohy.'};
 }
 if(rows===0){
  if(loading)return {kind:'loading',text:'Ověřuji blízké spoje…',detail:'Zatím nelze vyhodnotit výsledek.'};
  if(error||liveIncomplete||!ownLive)return {kind:'timetable',
   text:'Podle jízdního řádu žádné blízké spoje',
   detail:'Bez úplných živých údajů nelze vyloučit opožděný spoj.'};
  return {kind:'none',text:'Žádné blízké spoje nezjištěny',
   detail:'V dostupných údajích není další spoj v okně ±2 minuty.'};
 }
 if(!ownLive||liveIncomplete||verifiedPeers<rows||!!error)return {
  kind:'partial',text:'Část údajů pouze podle JŘ',
  detail:'Šedé označení znamená, že aktuální pořadí nelze spolehlivě ověřit.'
 };
 return {kind:'live',text:'Živé odchylky dostupné',detail:'Pořadí je orientační podle aktuálních odchylek.'};
}
