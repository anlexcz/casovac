# Časovač – okolní spoje a společné nástupní hrany (fáze 5B)

**Stav:** Implementováno a automaticky testováno v PR #58; před sloučením ověřit provozní chování. Zdroj pravdy je aktuální denní PID GTFS a ověřený PID registr fyzických hran. Tato část **není** výpočtem bezpečné vzdálenosti tramvají ani příkazem k jízdě.

## Dvě oddělené funkce

- **Klasifikace zastávek:** pouze při sestavení PID denního balíčku (-1, 0, +1), nikoli průběžně za jízdy. Klasifikuje konkrétní návštěvu zastávky podle `trip_id + stop_sequence + physical_platform_id`. Výlukové varianty trasy a změny provozního dne přicházejí automaticky z čerstvého GTFS.
- **Okolní spoje:** za jízdy se pro danou fyzickou hranu načítají plánované odjezdy všech relevantních tramvají (GTFS route_type 0), autobusů (3) a trolejbusů (11). LIVE z Golemio může zpřesnit odhad, ale bez LIVE nesmí aplikace vymýšlet zpoždění.

## Množinové vyhodnocení tramvajových sbíhání

Pro každou ověřenou fyzickou hranu P a provozní den vytvořit směrové varianty vedení linek podle posloupnosti fyzických GTFS hran. Pro vlastní příchod z předchozí hrany A porovnat:

- `L(P)`: množina tramvajových linek přijíždějících na P.
- `L(A→P)`: množina tramvajových linek přijíždějících na P z **téže předchozí fyzické hrany A**.
- `N = L(P) \ L(A→P)`: linky, které se na P objevují z jiné příjezdové větve.

Nenulové N a odlišná ověřená předchozí fyzická hrana spouštějí **tram-route-set**. Nevyžaduje se společné pokračování za zastávkou ani aktuálně blízký další spoj. Rozdílné `stop_id` na **téže** fyzické hraně nejsou dvě různé větve. Stejné číslo linky ve dvou variantách bez rozlišitelné nové linky není samo o sobě automaticky potvrzené sbíhání; může být vyřešeno geometrií.

Z potvrzených GTFS `shapes` lze navíc rozpoznat `tram-branch-confirmed`, i když obě větve mají stejné číslo linky. Pokud geometrie jednoznačně ukáže stejný přístupový koridor, potlačí falešný množinový příznak. Při neurčité geometrii zůstává legitimní množinový příznak založený na skutečně **nové lince**; podobnost názvů nebo blízká GPS nikdy neprokazují společnou fyzickou hranu.

## Klasifikační stavy

| Druh | Význam | Automatika „významné“ | Automatika „všechny“ |
|---|---|---|---|
| tram-route-set | Na hranu přichází nová tramvajová linka podle množin | Ano | Ano |
| tram-branch-confirmed | Rozdílný příjezdový koridor prokázaný shapes | Ano | Ano |
| mixed-platform | Společná fyzická hrana s autobusem/trolejbusem | Ano | Ano |
| mixed-confirmed | Navíc existuje plánově časově blízký silniční spoj | Ano | Ano |
| shared-platform | Více tramvajových linek sdílí hranu bez nového sbíhání | Ne | Ano |
| tram-branch-candidate | Neověřený typ/varianta trasy, diagnostika | Ne | Ne |

Zastávky, kde se linky jen **rozdělují** po společném příjezdu, nejsou v režimu „významné“ automaticky spojovacím konfliktem. V režimu „všechny“ mohou být sdíleným místem. V seznamu zastávek je malý topologický symbol: **⋈** sbíhání, **◈** smíšená hrana, **↔** běžná společná hrana. Značka neznamená LIVE konflikt.

## Datové soubory a limity

`scripts/build_pid_data.py` generuje:
- `days/YYYY-MM-DD/platform-encounters/00.json` … `15.json`: produkční potvrzené příznaky, dělené SHA-256 prvním bajtem z `trip_id` modulo 16. V aplikaci se načítá **pouze jeden bucket sledovaného tripu**; každý asset je kontrolovaný checksums indexem.
- `days/YYYY-MM-DD/platform-candidates.json`: neověření kandidáti pouze pro audit, ne pro automatické otevření.
- `stops/gtfs-map.json`, `stops/platforms.json`: jediná autorita pro ekvivalenci fyzických nástupních hran. Název a souřadnice pro spojení nestačí.
- Publikované statické `departures` a `routes` zůstávají oddělené; není nutné pro každý spoj znovu skenovat celé GTFS za jízdy.

`scripts/check_pid_bundle.py` ověřuje existenci všech 16 bucketů, počty tripů, checksums a maximální velikost **5 MiB** jednotlivého souboru. `src/pidStatic.ts` zůstává kompatibilní se staršími publikacemi s jediným `platform-encounters.json`, ne však s chybějícím balíčkem bez bezpečné kontroly.

## Zobrazení a stavový automat

1. `useAutoPlatformPlan` načte předpočítané příznaky sledovaného tripu. Bez důvěryhodného indexu se automatika **nezapne**; ruční otevření je nezávislé.
2. `autoPlatformLifecycle.pickAutoPlatform` vybere nejbližší relevantní místo. Otevření se připravuje **před předchozí zastávkou** (výchozí předstih 90 s před jejím očekávaným příjezdem); když je už potvrzený pobyt v předchozí zastávce, může se otevřít hned.
3. Okolní odjezdy jsou v jednom chronologickém panelu pro tram/bus/trolley, v okně **±120 s**, pokud uživatel nezvolil vlastní okno. Široké statické hledání (-45/+20 min) umožní dohledat silně opožděné spoje bez hledání všech vozů v reálném čase.
4. Žádné jiné blízké spoje: otevře se informační stav podle míry dostupnosti LIVE. Šedé **JŘ** znamená neověřené zpoždění. Šipka je **podle plánového pořadí**, barevně podle téhož vyhodnocení jako odchylka (zelená/oranžová/červená/šedá). Není to predikce s garancí.
5. Automatický panel zůstává připnutý do **potvrzeného odjezdu za cílovou zastávku**. Při dvou sousedních relevantních místech se po potvrzeném příjezdu do prvního může přepnout na druhé. Nedostupné LIVE nebo změna předpokládaného času samy nesmějí panel uzavřít.
6. **Ruční kliknutí na jakoukoliv zastávku** včetně obyčejné zastávky musí otevřít stejný panel i bez předem vypočítané klasifikace, při nulovém výsledku i GTFS-only. Ruční zobrazení má přednost před automatickým. Ruční náhled jiné zastávky nesmí být považován za skutečný provozní postup.
7. Ručně zavřený automatický panel se při téže identitě stop/trip neobnovuje každým LIVE refreshem. Nová cílová zastávka se ale může otevřít.

## Omezení opakovaných upozornění a čas otevření (listopad 2026)

Automaticky není třeba znovu zobrazovat panel pro cílovou zastávku C, jestliže **všechny aktuálně zobrazitelné okolní tripy již s naším tripem projely bezprostředně předchozí společnou zastávku B ve srovnatelném čase**. Nejde o shodu čísla linky: porovnává se individuální GTFS trip a jeho předcházející stop, přičemž rozdílná `stop_id` musí být prokazatelně mapovaná na **stejnou fyzickou hranu**. Předchozí plánové časy se musí vejít do ±120 s, při dostupných obou odchylkách se rozdíl přepočte. Pokud některý trip skutečně přijíždí nově, předchozí stop ID/čas není ověřen nebo není ještě dokončený celý aktuální přehled, tuto heuristiku nepoužijeme k potlačení nového upozornění. Prázdný seznam zůstává informativním nulovým stavem podle dřívější specifikace. **Ruční otevření je bez tohoto filtru.**

Aby panel nevyskočil už hned při odjezdu z A na dlouhém úseku A→B, čas otevření pro cíl C je nyní omezen na posledních `clamp(25 % plánované jízdní doby A→B, 12 s, 30 s)` před očekávaným příjezdem do **B**, zároveň se respektuje nastavený maximální předstih. Je-li už potvrzený pobyt v B, panel se může otevřít hned. Otevřený panel zůstává připnutý do ověřeného odjezdu z cíle C podle dosavadního stavového automatu. Bez úplných dat není dovoleno zaměňovat „zatím neověřeno“ za „všechny spoje už znám“.

## Ochrany a omezení

- Golemio se typicky obnovuje po 60 s. Přednačtení používá jeden statický vyhledávací index a limitovaný společný LIVE snapshot. Pokud se nepodaří získat všechny linky/odchylky, je výsledek označen jako **neúplný**, nikoli jako bezpečně bezkonfliktní.
- GTFS-only režim nemá zelené ani červené LIVE hodnocení, pokud není dostupná ověřená vlastní i cizí odchylka. Pouhý plánový čas není LIVE.
- Automatické potvrzení příjezdu či odjezdu vyžaduje čerstvé odpovídající Golemio `at_stop/on_track` + stop sequence; pouze uběhlý čas není potvrzením.
- Výpadek nebo zastarání dat nemá měnit ručně zvolený spoj. Není podporováno odvozování společné hrany jen z blízké GPS.
- Tento systém **neslouží k bezpečnostnímu rozhodování** o pohybu tramvaje, předjíždění nebo změně pořadí; pouze orientační informační panel.

## Testování před nasazením

V CI:
```
python -m unittest discover -s tests -p 'test_*.py' -v
npm ci --no-audit --no-fund
npm test
npm run build
```
Samostatné `Verify 5B against live PID GTFS` stahuje aktuální PID GTFS, vytvoří tři dny, ověří manifest, 16 bucketů, checksumy a limity a vypíše seznam rozpoznaných sbíhání.

Před sloučením PR #58 je nutné ověřit také mobilní UX a praktickou jízdu: Palmovka, náměstí Republiky, čistě tramvajové sbíhání a následné rozdělení, dvě spojovací zastávky bezprostředně po sobě, včasné otevření u krátkých intervalů, GPS zapnuto/vypnuto, LIVE 429/offline, půlnoc a řetězení 5↔6 / 9↔10.

**Odkazy:** [PR #58](https://github.com/anlexcz/casovac/pull/58), [issue #57](https://github.com/anlexcz/casovac/issues/57), [roadmapa](https://docs.google.com/document/d/1yQgR7qBeSyasJYoIftRQq7cs5OiQBsQTKqvfntOkcn0/edit).
