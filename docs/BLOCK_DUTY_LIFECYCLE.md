# Časovač · identita blokových výkonů a LIVE rozestupy (PR #62)

## Zdroj pravdy

- `trip_id` je jeden konkrétní GTFS spoj; `block_id` je PLÁNOVANÁ posloupnost tripů a samo o sobě nedokazuje totožnost reálného vozu.
- Sousední výkon před/za se volí **podle pevného JŘ na společném směrovém úseku**, nikoli podle aktuálního zpoždění. Zpoždění nemůže obrátit samotnou plánovou identitu.
- Pro navázání na jinou linku musí jít o bezprostředně sousední tripy stejného bloku ve stejném provozním dni, časově správně seřazené a s ověřenou přechodovou hranou. Intervenující trip ani shoda stejného čísla vozu bez GTFS návaznosti nestačí.

## Sloučení příjezdu a odjezdu na jedné hraně

`src/boardBlockContinuity.ts` nad denním PID GTFS vyhledá konkrétní vstupní a výstupní trip ve stejném `block_id`. Podmínky: jsou **přímými sousedy** v chronologickém block indexu bez nejednoznačných shod časů; konečná příchozího tripu a první zastávka odchozího tripu se mapují na **stejnou ověřenou fyzickou nástupní hranu**; plánovaný rozdíl příjezdu→odjezdu je 0–180 sekund; oba tripy mají jednoznačné relevantní zastavení. Při neověření se neslučují.

V `stopNeighbourBoard.ts` se *až po filtrování skutečně zobrazitelných řádků* slučuje dvojice, pokud jsou přítomné oba tripy. Zůstane **jeden řádek odjíždějící linky a jejího JŘ času**, přičemž doplněk `← příchozí linka` vysvětlí návaznost. U příjezdu známé číslo vozu lze zobrazit s hvězdičkou jako poslední příjezdovou identitu, **nikoliv jako LIVE potvrzení vozidla na odchozím tripu**. Příjezdové LIVE zpoždění se nesmí bez ověření převést na odjezdové. Pokud je vlastní sledovaný trip jednou stranou tohoto přechodu, druhý se nezobrazuje jako jiné vozidlo. Normalizace odstraňuje i starý duplicitní příjezdový řádek z cache `stableNeighbours.ts`.

Pro fallback Golemio rozpozná modul i plánované ISO časy, ale nikdy nespojuje neověřené sousední nástupní hrany podle pouhé podobnosti názvů. Návaznosti se cachují pro konkrétní provozní den, fyzickou hranu a verzi manifestu PID; při neúspěšném GTFS lookupu se použije nesloučený bezpečný seznam.

## Sledování LIVE rozestupů

`src/usePlannedHeadways.ts` při posunu referenční zastávky podrží poslední známé plánové sousedy **téhož vlastního tripu a dne**, než doběhne nové ověření PID; nepřevádí je přes jiné vlastní tripy. Uživatel nepřijde o rozestup jen kvůli probíhajícímu fetchi.

`src/peerDutyContinuity.ts` předá seznam postupných ověřených tripů se začátkem, koncem, terminální zastávkou a `block_id`. V `usePlannedPeerPositions.ts` identita dotazu závisí na provozním dni a plánových sousedních tripech, **ne na každé referenční zastávce**. Anchor skutečně pozorovaného evidenčního čísla se pamatuje pro původní trip a pro již ověřený blok. Pokud původní trip nikdy nebyl LIVE zachycen, lze použít čerstvé měření přímého nástupce přesně z GTFS, ale s označením **provisional**: prokazuje LIVE onoho aktuálního tripu, nikoli stejný fyzický vůz jako u minulého tripu. Při existujícím anchoru se jiné evidenční číslo odmítne.

`src/peerLiveResolve.ts` slučuje opakované identické záznamy z route snapshotu a detailního trip endpointu, vybírá nejnovější `origin_timestamp` a odmítá dvě odlišná vozidla s totožnou nejnovější identitou tripu/času. Nesmí vybrat jiný bližší LIVE vůz pouze kvůli poloze.

`src/vehicleObservationStore.ts` uchovává po konkrétním provozním dni a `trip_id` poslední potvrzenou LIVE observaci, nejvýše 450 záznamů. Úspěšný HTTP požadavek bez tripu ani prázdná odpověď poslední observaci neodstraňuje. **Čerstvost výpočtu** je nejvýše 90 sekund od skutečného `origin_timestamp`, zatímco **poslední známý stav** lze pro orientační prezentaci uchovat nejvýše 180 sekund. Historická poloha se nesmí tvářit jako nové LIVE měření.

`src/stableHeadway.ts` stabilizuje naposledy vypočítaný rozestup pro stejný trip a referenční zastávku. Po 90 sekundách bez nové platné observace se může zobrazit se značkou `≈` jako **poslední známý rozestup**, po 180 sekundách přejde na plánový/odhadovaný stav. Nová skutečně změněná odchylka se promítne okamžitě. Stejný HTTP payload nesmí znovu spustit stopky na 180 sekund.

## Provozní fáze a viditelnost

`src/trackedDuty.ts` určuje fázi **plánovaného výkonu**, nikoli nahodile jediného `trip_id`:

| Fáze | Co se zobrazí |
| --- | --- |
| `before-service` | LIVE rozestup se skrývá; identita souseda zůstává sledována |
| `running` | Rozestup se zobrazuje, pokud je LIVE platné; jinak poslední známý/plan |
| `terminal-wait` | Rozestup se skrývá během prokázaného pobytu na konečné nebo mezi ověřenými pokračujícími tripy |
| `after-service` | Po skončení výkonu se rozestup skryje; bez chybové hlášky „LIVE neexistuje“ |
| `unknown` | Bez úplné časové evidence se nic neskrývá jen na základě odhadu |

Příjezd na konečnou potvrzujeme z čerstvého `at_stop` a přesné koncové `stop_id`, případně zobrazíme **plánový** stav podle GTFS času – nikdy netvrdíme potvrzený příjezd jen proto, že uplynul JŘ čas. Při zpožděném čerstvém LIVE měření po plánovaném konci zůstává výkon aktivní.

## Diagnostika a testy

V Diagnostice Časovače se pro ↑/↓ ukáže fáze, zdroj LIVE, důvod odmítnutí (`missing`, `stale`, `ambiguous`, `vehicle-mismatch`), poslední evidenční číslo a **skutečný čas měření**. Neuvádí se API klíč ani soukromá GPS telefonu.

Regresní testy zahrnují: bezprostřední sousedy vs. mezilehlý trip, jedna vs. dvě různé fyzické hrany, 3min hranici přechodu, duplicitní záznam z route/exact API, skutečně různá vozidla ve stejném čase, přímého successor bez minulého LIVE, mismatch již známého vozu, konec/předzačátek služby, expiraci 90/180 s a odstranění falešného starého řádku při sloučení.

**Provozní akceptace:** otestovat během skutečné směny přechody 5↔6, 9↔10, krátký obrat na konečné a výpadky Golemia. Syntetické CI neprokazuje skutečné chování různých Golemio statusů v terénu.

**Implementace:** [PR #62](https://github.com/anlexcz/casovac/pull/62). Navazuje na [fázi 5B](STOP_NEIGHBOURS.md).
