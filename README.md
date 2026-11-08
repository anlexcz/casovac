# Časovač 0.9

Mobilní webová pomůcka pro sledování tramvajového pořadí PID. React, TypeScript, Vite a GitHub Pages.

## Používání

1. V **Nastavení** vlož osobní Golemio API klíč. Volitelně zaškrtni jeho zapamatování.
2. Zadej linku a pořadí (například `25/5`) a klikni na **Sledovat**.
3. Na hlavní stránce se zobrazí přiřazené vozidlo, zastávka, plánovaný odjezd, odpočet a několik okolních zastávek.
4. GPS lze zapnout a vypnout v horní liště. Prohlížeč si pamatuje preferenci; při novém otevření se pokusí získávání polohy spustit znovu, pokud to oprávnění a pravidla Androidu dovolí.
5. Plovoucí tlačítko otevře **Diagnostiku**, kde zůstávají původní technická data a ruční výběr tripu.

Poslední zadané `linka/pořadí` se uchovává místně. Pokud je API klíč uložený a sledování ještě nevypršelo (4 hodiny od aktivace), aplikace po znovuotevření sledování obnoví. Bez zapamatovaného klíče je nutné znovu zadat klíč a sledování spustit.

## Princip

- Živá vozidla z Golemio vehiclepositions každých 20 sekund.
- Pořadí primárně přes `trip.sequence_id`.
- Zastávky, časy a geometrie se u ověřeného tripu primárně načítají z lokálně publikovaného PID GTFS (`public/data/pid/v1/`); pokud nelze bezpečně potvrdit datum, identitu nebo úplnost dat, zachová se původní Golemio GTFS fallback.
- GPS porovnává telefon s polohou vozidla a očekávanou zastávkou. Dvě po sobě jdoucí měření s rozestupem 3 sekund, dostatečná přesnost a poloha kompatibilní s Golemiem jsou potřebné k potvrzení zastávky.
- Manuální korekce zastávky je k dispozici na hlavní obrazovce i v diagnostice.
- Odpočet je pouze vůči **plánovanému času odjezdu**, při překročení času pokračuje záporně. Nejde o výpočet skutečného oprávnění k odjezdu.

## Časovač 2.0 – stav migrace dat (8. listopadu 2026)

Původní jádro Časovače zůstává v provozu. V PR #34–47 přibyla samostatná PID GTFS vrstva a postupné přepojení jednotlivých modulů. **Nejde zatím o plně offline aplikaci.**

| Oblast | Zdroj / stav |
| --- | --- |
| Hlavní jízdní řád a geometrie | PID GTFS first, Golemio fallback u ověřených tripů |
| Řetězení | Univerzální PID `block_id` a chronologicky sousední tripy, jinak Golemio fallback |
| Jízdní řády pro rozestupy | PID GTFS first; skutečná poloha a odchylka z Golemia |
| Statické detaily okolních odjezdů | PID GTFS first po ověření `trip_id`, dne, linky a přesného `stop_id` |
| Živé polohy a aktuální odjezdy | Golemio `vehiclepositions` a `departureboards` |
| Opakovaně používaná GTFS data | Verze manifestu, SHA-256, perzistentní IndexedDB cache |
| Plně offline otevření stránky | Zatím ne: vyžaduje Service Worker (budoucí fáze 7) |

Plánovaná pokračování jsou samostatná: **fáze 4** musí zachovat známé plánované sousedy i při nedostupném živém zpoždění; **fáze 5** musí získat vlastní plánované odjezdy ze statických GTFS a oddělit je od živých konfliktů; **fáze 6** musí sjednotit a měřit živé Golemio snapshoty. Přepojení zdroje ve fázi 3 neznamená automatické dokončení těchto funkcí.

Nejbližší potřebná kontrola: audit skutečného počtu HTTP dotazů po migraci oproti historické baseline (která nebyla zachycena), stav fallbacků, mobilní test, noční provoz a přesné nástupní hrany. Bez měření nelze tvrdit konkrétní celkovou procentní úsporu API požadavků.

Roadmapa a průběžné protokoly jsou vedeny ve složce **Časovač** na Google Disku; poslední implementační změna: [PR #47](https://github.com/anlexcz/casovac/pull/47).

## Soukromí

API token se ukládá do `localStorage` **pouze s výslovným zapamatováním**. To není bezpečný trezor; na sdílených zařízeních volbu nepoužívej. Bez zapamatování je token jen v paměti stránky. Poloha telefonu se používá lokálně ve webu a neodesílá se na vlastní server. Volání Golemia používají token v hlavičce `X-Access-Token`.

## Vývoj

```sh
npm ci
npm run test
npm run dev
npm run build
```

Nasazení probíhá workflow `Deploy Časovač` na GitHub Pages: https://anlexcz.github.io/casovac/

## Známá omezení

- Při špatném nebo nedostupném API musí obrazovka zobrazit nejistý stav, nikoli potvrzení odjezdu.
- V oblasti konečných, řetězených linek a při změně pořadí může být párování živého vozidla nejednoznačné.
- Přepínání zastávek dle GPS je konzervativní; vyžaduje soulad s posledním hlášením Golemia a vyhovující GPS fix.
- Webová GPS není garantovaná při zamknutém displeji ani při práci na pozadí.
- Odpočet se nezohledněním posunů či výluk nezmění ve skutečné oprávnění k odjezdu. Časovač je jen orientační informační pomůcka.

## Diagnostický audit identifikátorů zastávek

V diagnostice otevři **Audit ID zastávek**. Srovnává:
- živé ID `last_position.next_stop.id` s `stop_id` všech výskytů zastávek konkrétního tripu;
- přesný řetězec a normalizovaný zápis;
- společný základ kódu `U...Z...P` bez automatického slučování různých nástupišť;
- počet chybějících/duplicitních GTFS ID;
- nejbližší zastávky vůči poloze hlášeného vozidla.

Kandidáti stejného základního kódu ani blízké GPS polohy **nejsou automaticky uznány jako shoda ID**. Srovnání slouží k nalezení skutečného problému parseru či rozdílného kódování. Pomocí tlačítka lze zkopírovat textový audit bez API tokenu a bez polohy telefonu.

Zpráva je stavovým snímkem během sledování. Při další aktualizaci živých dat se kandidáti přepočítají. Jakmile se prokáže skutečná struktura kódů, lze vytvořit explicitní bezpečný převod.

## Časovač 0.5: potvrzení opuštění zastávky

Nová logika `src/departure.ts` sleduje aktuální zastávku během pobytu i rozjezdu a až po prokazatelném odjezdu přepne hlavní kartu a odpočet na následující zastávku.

**Podmínky pro automatické přepnutí při použití GPS telefonu:**

- telefon byl před odjezdem rozpoznán do 35 m od zastávky;
- GPS je aktuální (max. 15 s) a přesná (max. 35 m), poloha telefonu souhlasí s vozidlem do 250 m, živá poloha vozidla není starší než 45 s;
- jsou dostupné souřadnice zastávky a pořadová geometrie GTFS `shapes`;
- minimální rychlost každého započteného vzorku je 9 km/h;
- vzdálenost telefonu od opouštěné zastávky je alespoň 50 m **a** posun vpřed podél `shapes` je alespoň 50 m;
- minimálně 3 samostatné vzorky GPS během nejméně 4 s;
- od prvního ověřovacího vzorku vzrostla vzdálenost od zastávky alespoň o 15 m a také postup po trase alespoň o 15 m;
- zásadní pokles vzdálenosti nebo výpadek přesnosti zruší rozpracované potvrzování.

Při spuštění sledování **mezi zastávkami** se systém nesnaží zpětně předstírat potvrzený odjezd. Nejprve musí zaznamenat přiblížení k zastávce. Když není dostupná spolehlivá GPS či `shapes`, automatické GPS přepínání se neprovede; zbývá původní informační určení z živých dat a ruční oprava. Rozpracovaná detekce se nepřenáší přes restart stránky ani změnu tripu.

V diagnostice je karta **Detekce odjezdu** s fází, vzdáleností, rychlostí, počtem měření, posunem po trase, odchylkou od trasy, důvodem čekání a posledním potvrzeným přepnutím. Prahy jsou prozatím testovací a mohou potřebovat úpravu po jízdních zkouškách.

GPS měření v prohlížeči nemusejí chodit pravidelně a při zamčeném telefonu se mohou pozastavit. Odpočet stále není provozní pokyn k odjezdu.

## Časovač 0.6: vzdálené sledování a záznam dat

**Zdroje polohy jsou oddělené.** Pokud GPS telefonu není dostupná, je nepřesná nebo se nachází více než 250 m od polohy sledované tramvaje, aplikace automaticky použije vzdálený režim a GPS telefonu neovlivňuje výběr zastávky. Stejný režim funguje také při úplně vypnuté GPS. Telefon není považován za poruchu vozidla.

- Sledování používá konkrétní živou polohu vozidla, ID následující zastávky, GTFS pořadí zastávek a geometrii `shapes`.
- Odděleně počítá stáří posledního úspěšného API dotazu a původního časového razítka polohy vozidla (pokud je k dispozici). Chybějící čas vzniku polohy se neoznačuje za čerstvou telemetrii.
- Na základě dvou odlišných časově seřazených hlášení lze krátce odhadnout další postup po trase. Maximální extrapolace je 20 sekund a 90 metrů; neověřený stav je označen jako odhad.
- Při neaktuální telemetrii nad 90 s, nesouladu polohy s trasou nad 150 m nebo neznámých údajích se predikce omezí či pozastaví.
- GPS detekce odjezdu z 0.5 zůstává pro telefon přímo ve vozidle.
- Užitečným výstupem pro ověření modelu je sériový záznam skutečných hlášení z testování.

**Jak zaznamenat test:**
1. Otevři aplikaci, zadej linku/pořadí a stiskni **Sledovat**.
2. Vpravo dole otevři **Diagnostiku**.
3. V panelu **Záznam testovací jízdy** stiskni **Spustit záznam**.
4. Nech aplikaci v prohlížeči otevřenou a aktivní, ideálně 30–60 minut. Lze při tom mít GPS vypnutou i zapnutou na jiném místě.
5. Stiskni **Ukončit záznam**, potom **Stáhnout JSON** a soubor přilož do chatu.

Každý úspěšný dotaz se ukládá jako samostatný vzorek i tehdy, když Golemio vrátilo stejnou polohu. Záznam zachovává čas žádosti, čas odpovědi, počet shod, surovou odpověď pro vybrané vozidlo, informaci o GPS režimu a vzdálenost telefonu od vozidla (je-li GPS dostupná). Ukládají se i chyby API, GTFS detail a volitelné poznámky.

**Uložení a soukromí:** záznam je uložen pouze místně v IndexedDB. Po obnovení stránky zůstane, ale pro další nové dotazy musí uživatel opět spustit sledování. Záznam je omezen na 2400 událostí a poté se automaticky zastaví bez mazání dat. Export přes tlačítko vytvoří JSON; API token se nesmí v exportu objevit. Souřadnice GPS telefonu se **standardně nezaznamenávají**. Samostatná volba před začátkem testu je může výslovně přidat. I při výchozím nastavení JSON obsahuje veřejně hlášené souřadnice vozidla; při sdílení souboru to zohledni.

**Omezení webu:** mobilní prohlížeče mohou na pozadí nebo se zamknutým displejem pozastavit časovače i síťové požadavky, takže není garantován nepřetržitý 20sekundový interval. Zaznamenané časové mezery jsou součástí testovacího výsledku.

## Diagnostika 2026-11-05: vůz na konečné není spárován s pořadím (bez změny aplikace)

**Výchozí pozorování od uživatele:** tramvaj je na konečné, její existenci i polohu lze ověřit v Mapě PID a do odjezdu zbývá určitý čas. V Časovači při sledování `25/5` kolem 11:44 API normálně odpovídalo (aktualizace 11:44:24), ale zobrazilo **8 vozů a 0 shod pořadí**. Ruční nabídka obsahovala pořadí `1, 2, 3, 4, 7, 8, 9, 10`; **pořadí 5 chybělo**. Proto se ukazoval prázdný trip, 0 zastávek, neznámá poloha a chybějící predikce. Pobyt na konečné je pro tento případ potvrzeným provozním kontextem; neznámá zůstává konkrétní reprezentace tohoto stavu ve vrácených datech.

### Podstatný nález v dokumentaci: includeNotTracking

Endpoint `GET /v2/vehiclepositions` podporuje parametr **`includeNotTracking=true`**. Dokumentovaný model `VehiclePositionsTripsModel.GetAll()` jej podporuje spolu s `routeShortName`, `cisTripNumber`, `includePositions` a `tripId`:
- https://operator-ict.gitlab.io/golemio/code/modules/vehicle-positions/classes/output_gateway_models_vehiclepositionstripsmodel.vehiclepositionstripsmodel.html
- https://api.golemio.cz/pid/docs/openapi/
- Historické odborné rozpracování významu `includeNotTracking`: https://dspace.cvut.cz/server/api/core/bitstreams/a5742075-a729-4423-a1f5-7e95c60efd0a/content (kapitola 2.2.2.3).

Tento parametr zahrnuje také **spoje mimo právě aktivní výjezd**, tedy před začátkem nebo po skončení tripu. Starší analýza uvádí přibližně hodinu před odjezdem a 10 minut po konci, ale **nejde o potvrzenou garanci aktuálního systému v roce 2026**. Zvlášť důležité: Časovač nyní volá pouze `/v2/vehiclepositions?routeShortName=25&limit=1000`, parametr `includeNotTracking` chybí. **To je velmi silná konkrétní hypotéza pro chybějící vůz na konečné.** K definitivnímu potvrzení je zapotřebí zachytit srovnávací odpověď obou variant dotazu ve stejném okamžiku, protože bez vlastního API tokenu nebylo možné aktuální konkrétní odpověď pro `25/5` reprodukovat.

### Řetězec ztráty informace v implementaci

1. `src/main.tsx` stáhne pouze aktivně hlášená vozidla vybrané linky, vybere kandidáty podle `properties.trip.sequence_id` (fallback `properties.trip.cis.order` nebo `properties.trip.order`) a případně kontroluje `route_short_name`. Nehledá zvlášť přiřazený vůz na konečné ani budoucí trip.
2. `chosen = null`, pokud shod není **právě jedna**. Nulová shoda i více shod jsou pro další části aplikace stejně nepoužitelné a nejsou odlišeny jako provozní stavy.
3. `tripId` se získává **pouze** z `chosen`, a `useTripData()` bez něj nevyhledá jízdní řád. `remoteEstimate()` bez vozidla a zastávek automaticky vrátí `unknown`. Chybějící GPS není příčinou; prázdná diagnostika je následkem nulového párování.
4. Diagnostika označuje aktualizaci jako `Online` podle stáří **API odpovědi**, nikoliv úspěšného spárování konkrétního pořadí. Z technického hlediska stránka pracuje správně, z pohledu uživatele však zavádí dojem, že hledaná tramvaj je sledována.
5. Ruční výběr v `src/Diagnostics.tsx` nabízí pouze přijaté `features`, takže nelze vybrat vůz chybějící v základním dotazu.
6. **Důležitá slabina sběru dat:** `src/recorder.ts` při 0 shodách zapisuje `matchingCount:0` a `vehicle:null`, ale **nezapisuje kompletní seznam ostatních kandidátů**. Testovací JSON tak nebude stačit k odhalení chybné `sequence_id`, změny `trip_id` nebo mezery v odpovědi. Diagnostika v budoucnu potřebuje zachovat alespoň přiměřeně omezený, očištěný seznam kandidátů a stavových polí.

### Další relevantní datové zdroje

- `/v2/vehiclepositions` s `includeNotTracking=true`: primární kandidát na zahrnutí vozidel před začátkem či po ukončení výjezdu.
- `/v2/public/vehiclepositions/{vehicle_id}` a varianta `.../{vehicle_id};gtfsTripId={gtfs_trip_id}`: ověřit možnosti vyhledávání podle fyzického vozidla v novějším Public Vehicle Positions API. Tyto URL jsou zahrnuty v dokumentaci monitorovaných veřejných API (2026), ale jejich chování pro přestávky na konečné nebylo ověřeno. Dokumentace: https://api.golemio.cz/pid/docs/openapi/
- GTFS jízdní řád / stop_times: získat plánovaný začátek **následujícího** tripu včetně odjezdové konečné; samotný GTFS však neurčuje se stoprocentní jistotou skutečně přiřazený vůz.
- Mapa PID: vhodná kontrola očekávaného chování, nikoli automaticky důkaz, že konkrétní výstup `/v2/vehiclepositions` bez `includeNotTracking` obsahuje dané pořadí.

### Přesný plán dalšího diagnostického testu (implementovat později)

1. Ve stejnou chvíli porovnat dotazy `GET /v2/vehiclepositions?routeShortName=25&limit=1000` a `GET /v2/vehiclepositions?routeShortName=25&limit=1000&includeNotTracking=true`. V exportu logovat počet výsledků, u všech kandidátů `vehicle_registration_number`, `sequence_id`, `trip_id`, linku, časy a případné příznaky stavu. Token neukládat.
2. Pokud se pořadí 5 v rozšířené odpovědi objeví, ověřit, zda má existující/nový `trip_id`, zda jde o stejný vůz, a zda odpověď uvádí čas budoucího odjezdu. Nepředpokládat, že jsou všechny hodnoty vyplněny.
3. Pokud ne, ověřit alternativní Public Vehicle Positions endpoint podle čísla skutečně známého vozidla a případně samostatné jízdní řády/odjezdy pro konečnou; kontrolovat i to, zda `routeShortName` a `sequence_id` během přestávky stále odpovídají předchozí či následující jízdě.
4. Pro aplikační logiku oddělit **identitu vozidla**, **služební pořadí**, **aktuální trip**, **stav na konečné** a **plánovaný další odjezd**. Tyto entity nemusejí být ve stejné chvíli vyplněné. Návaznost přes konečnou podporovat jen při prokazatelném spárování, nikoliv podle nejbližší tramvaje.
5. V UI zobrazovat `Stojí na konečné · odjezd HH:mm` jen při potvrzené vazbě na vozidlo a jízdní řád. Při dočasně chybějícím tripu ukázat například `Vůz nalezen, čeká na začátek spoje` nebo `Pořadí momentálně bez aktivního tripu`; při nenalezeném voze odlišit `Vůz v aktuální odpovědi nenalezen`.
6. Nepouštět predikci pohybu/odjezdu jen z uplynutí jízdního řádu, zejména při pobytu na konečné.

**Stav:** pouze diagnostický nález a návrh; **žádné změny funkčního kódu, API dotazů nebo UI nebyly provedeny**.

## Časovač 0.7: výsledky prvního testu a tři testovací režimy (5. 11. 2026)

První 5,5minutový záznam pořadí `25/5` obsahoval 16 úspěšných dotazů Golemia, šest odlišných časů původních hlášení a 655 GPS událostí telefonu mimo tramvaj. Všechny GTFS zastávky mají v tomto formátu prázdné `stop_id`, ale korektní `stop_sequence` a souřadnice. Živé hlášení obsahuje `last_position.last_stop.sequence`, `next_stop.sequence` a `state_position` (`at_stop`, `on_track`). Proto je **pořadí zastávky** důvěryhodnější párovací klíč než přímé srovnávání `stop_id`.

Změny v 0.7:
- Ve vzdáleném režimu mají přednost číselné sekvence zastávek; stav `at_stop` ukazuje právě obsluhovanou zastávku, `on_track` následující zastávku. Toto platí i když je GPS telefonu vypnutá nebo několik kilometrů daleko.
- Samostatně se zobrazuje stáří telemetrie vozidla a API odpovědi. Při zpožděných hlášeních se stav označuje jako nejistý, při velkém zpoždění se nevymýšlí další průjezd. Odhad polohy z geometrie je pouze záložní metoda.
- GPS telefonu se považuje za zdroj z tramvaje až při aktuálním a přesném měření do 250 m od polohy vozu. Vzdálenost 1 000 m jednoznačně znamená vzdálené sledování. GPS se stále používá pouze lokálně; rychlostní podmínky odjezdu se neuplatňují při vzdáleném sledování.
- Když běžný dotaz nevrátí žádnou shodu pořadí, zkusí se druhý dotaz s `includeNotTracking=true`; to může doplnit tramvaje čekající na konečné. Zda skutečně pokryje konkrétní typ stání, musí potvrdit test. Při nulové shodě se do diagnostiky zapisuje seznam kandidátů bez API tokenu.
- Do diagnostiky přibyly tři scénáře, jejichž označení se ukládá do exportu: **GPS vypnutá**, **GPS zapnutá mimo tramvaj**, **GPS zapnutá na palubě**.
- Surové GPS vzorky telefonu se při vzdáleném testu (a pouze po volitelném souhlasu k jejich exportu) zapisují maximálně jednou za 30 s; při poloze u tramvaje maximálně jednou za 2 s. Původní limit 2 400 událostí díky tomu vydrží podstatně déle. Každá API odpověď se stále loguje zvlášť, i když je totožná.

**Doporučený postup:** Pro každý scénář vytvořit nový záznam, sledovat stejné pořadí po 20–30 minutách a exportovat tři oddělené JSON soubory. Testy s GPS jsou nezávislé na tom, zda telefon skutečně v tramvaji je; aplikace režim vyhodnocuje sama, volba scénáře slouží jako popisek experimentu. Pro test na palubě lze zapnout export souřadnic telefonu, ale jde o citlivá data. Při řízení tramvaje s aplikací nemanipulovat; ovládání a ukládání provádět před jízdou nebo mimo řízení.

**Zbývající omezení:** Pokud je vozidlo mimo seznam obou dotazů, aplikace ho nemůže spolehlivě identifikovat pouze podle jízdního řádu. Stáří dat a chybné či opožděné polohy se musí dál ověřit na delších záznamech. Pobyt na konečné zatím nemá samostatnou plnohodnotnou obrazovku; doplněn je první datový fallback.

## Časovač 0.8: stabilní GPS na palubě, konečné a záznam rozhodování

Nová logika `src/onboard.ts` zohledňuje, že polohy vozidla z Golemia mohou být o desítky sekund starší než GPS telefonu.
- **Prvotní párování je přísné:** telefon musí mít aktuální přesnou GPS do 250 m od hlášeného vozidla, při starší poloze vozidla do 100 m. Blízkost samotné tramvajové trasy k párování nestačí.
- **Udržení už potvrzeného párování:** pokud Golemio zaostává, lze dočasně přijmout vzdálenost telefonu až 750 m, pouze když telefon zůstává do 65 m od geometrie sledovaného tripu, hlášení je 25–125 s staré a telefon byl v posledních 150 s opravdu u vozidla. Zamezí se výpadkům palubního režimu kvůli jedné zpožděné zprávě.
- **Rozpojení:** 1 000 m od tramvaje znamená okamžité vzdálené sledování bez ohledu na trasu. Také dlouhodobá neshoda nebo zastaralá/nepřesná GPS vrací vzdálený režim.
- **Ověření odjezdu:** `src/departure.ts` nyní přijímá rozhodnutí modulu párování namísto druhé, nesouvisející, pevné kontroly do 250 m. Ostatní podmínky (50 m, 9 km/h, pohyb po trase, 3 fixy/4 s) zůstávají.
- **Hledání vozu na konečné:** když základní dotaz nevrátí pořadí, aplikace zkusí `includeNotTracking=true`. Pokud se podaří určit vůz a GTFS trip, leží do 150 m od jeho první zastávky a má plánovaný odjezd v následujících 120 minutách, zobrazí stav **Čeká na odjezd z konečné** a plánovaný odpočet. Jde o odvozený, nikoli API výslovně potvrzený terminálový stav; podmínkou je také přítomnost `at_stop` nebo výsledek rozšířeného dotazu. Pokud je dostupná jen identita vozu bez tripu, zobrazí se vůz a vysvětlení, že chybí jízdní řád, nikoli smyšlená zastávka.
- **Diagnostika:** ukazuje výsledek párování GPS, vzdálenosti telefonu od vozidla a trasy, zdroj dotazu, seznam kandidátů i stav čekání na konečné. Záznamový režim navíc exportuje samostatné události `decision` při změnách zastávky, režimu GPS nebo detekce odjezdu; neukládá tyto události každou sekundu.

**Co zůstává k ověření:** konkrétní Golemio odpověď pro vůz na konečné a přesnost propojení mezi navazujícími tripy; web zůstává orientační pomůckou. Nejde o bezpečnostní pokyn pro řidiče.

## Časovač 0.9: neztrácet vůz po skončení tripu (5. 11. 2026)

**Reprodukce:** ve 12:34 aplikace po zadání `25/5` zobrazila, že pořadí není nalezeno. Předchozí testovaný trip `25_17947_260831` měl konec na Výstavišti ve 12:26, tedy 8 minut před screenshotem. Chybějící nový aktivní trip nevypovídá sám o sobě o fyzickém zmizení vozu z provozu; původní kód ale bez aktuální shody neukazoval ani poslední potvrzený vůz.

Změny:
- `src/lastSeen.ts` uchovává v místním `localStorage` poslední potvrzenou identitu vozidla, trip, konečný čas přijetí a poslední hlášené zastávky pro konkrétní `linka/pořadí` (nejvýše 6 h). Neuchovává klíč Golemia. Pokud dosud není vlastní cache, může načíst poslední odpovídající vozidlo ze záznamu diagnostiky.
- Pokud pořadí zmizí z aktivního i rozšířeného dotazu `includeNotTracking`, UI nadále ukáže **poslední potvrzený vůz a čas posledního hlášení**, nikoli prázdné identifikační údaje. Zároveň výslovně uvede, že momentální stání na konečné není potvrzené.
- Pokud je známé číslo vozidla, aplikace nanejvýš jednou za minutu zkusí širší dotaz na živá vozidla bez filtru linky (s `includeNotTracking=true`). Hledá přesně tentýž vůz, nikoli shodné pořadí jiné linky. Pokud má stále danou linku i pořadí, znovu jej připojí. Pokud má jiný trip, jen oznámí kde se objevil; nepředstírá kontinuitu stejného pořadí.
- Diagnostika zobrazuje poslední známý vůz, čas posledního výskytu, režim dotazu a případné nalezení vozidla na jiné lince/tripu.
- Matchování pořadí má doplňkový fallback na `trip.gtfs.run_number` (pouze pokud se nedá použít žádný běžnější identifikátor).

**Limity:** Záložní širší dotaz je dostupný jen při existenci předchozí bezpečně spárované identity. Pokud se pořadí poprvé hledá až po zmizení z dat a neexistuje historie či diagnostický záznam, není možné garantovat identifikaci fyzického vozu. Stejně tak poslední známá poloha neprokazuje, že tramvaj stále stojí právě na konečné. Pro definitivní model návazných tripů bude potřebná další empirická diagnostika.

## Časovač 1.2 – návazné tripy na konečné a automatické obnovení pořadí

**Zdroj:** testovací záznam 5. 11. 2026 pro linku 25 / pořadí 5 / vůz 9147 (Bílá Hora, odjezd 13:27, nový trip `25_13381_260831`). Před jízdou Golemio poskytuje `before_track`, po aktivaci `at_stop` na první zastávce a při jízdě `on_track`. Dotaz s `includeNotTracking=true` může najednou vracet pro stejné pořadí jak předchozí `after_track`, tak další `before_track`; dvě takové shody nejsou chyba ani dva vozy.

- **Výběr tripu:** nový `src/tripSelection.ts` vybírá podle linky a pořadí nejprve jednoznačné fyzické vozidlo; teprve z jeho tripů upřednostní aktivní `at_stop/on_track`, následně nejbližší připravovaný `before_track`, a nakonec ukončený `after_track`. Při více různých vozech se používá jen dříve potvrzené evidenční číslo; pokud chybí, zůstává stav nejednoznačný.
- **Dotaz:** `/v2/vehiclepositions?routeShortName=...&limit=1000&includeNotTracking=true` je nyní výchozí, aby Časovač nehledal připravovaný trip jen po předchozím neúspěchu. Suroví kandidáti zůstávají v diagnostice.
- **Konečná:** připravený trip načítá svůj GTFS stop_times, směr a odpočet od první zastávky. Šedý řádek `clockTerminal` zůstává ve stavu `before_track` i na první zastávce `at_stop`; přechod do normálního barevného režimu nastane až po potvrzení jízdy `on_track` nebo GPS odjezdu. Potvrzení je v rámci tripu zapamatované, aby šedá neblikala při dalších hlášeních.
- **Palubní GPS:** párování se nyní váže na fyzické evidenční číslo, a nezaniká samo o sobě při přechodu mezi tripy. Dříve spárovaný telefon může na trase zůstat spárovaný i při dlouho neaktualizované GPS vozu, včetně rozdílů nad 750 m; čerstvý nesoulad vozidla nebo opuštění koridoru trasy se dál vyhodnocují opatrně. Prvotní spárování zůstává přísné a vyžaduje skutečnou blízkost.
- **Automatické obnovení sledování:** po zadání `Sledovat` se linka/pořadí ukládají do `localStorage` na **4 hodiny** pod `casovac:active-order:v1`. Pokud je při obnovení stránky stále platná volba a uživatel má dostupný uložený Golemio token, sledování se samo znovu zahájí. Při vypršení 4 hodin se automaticky neobnoví. Po explicitní změně pořadí začíná nové čtyřhodinové okno. Při smazání tokenu je odstraněna i volba aktivního sledování. Uložené pořadí neobsahuje token ani GPS telefonu.
- **Záměrné omezení:** automatické obnovení neprodlužuje expiraci každým načtením stránky. Průběžné sledování může pokračovat, ale po čtyřech hodinách od zvolení pořadí se již po restartu stránky nespustí samo.

**Důležité pro test:** rozpoznávání konečné je založeno na odpovědích testované linky 25; ostatní linky s nepravidelnými službami mohou mít jiné stavy a časové vztahy. Odpočet je čistě informativní, nikoli provozní pokyn.

## Audit animace a přepínání bez GPS (5. 11. 2026) – verze 1.3

### Zjištění z diagnostických exportů

Pět diagnostických záznamů linky 25/5 obsahuje přímo hlášení `last_position.state_position` a původní časy `origin_timestamp`. U **13 navazujících dvojic** nových hlášení `at_stop → on_track` pro stejnou poslední zastávku je medián časového rozestupu **64 s** (rozsah 31–74 s, průměr 58,3 s). Tyto hodnoty nejsou čistou dobou pobytu v zastávce: zahrnují i prodlevu sběru či publikování telemetrie. Ve čtyřech z těchto situací původní GPS na palubě potvrdila skutečný odjezd před doručením aktuálního `on_track`, takže čekání na `on_track` pro včasné přepnutí nestačí.

**Nový algoritmus `src/remoteProgress.ts`:**
- V režimu mimo palubu vychází z posledního hlášení `at_stop`, jeho `origin_timestamp`, `last_stop.sequence`, `next_stop.sequence`, plánovaných časů GTFS a zpoždění `last_stop_arrival` či `actual`, pokud je dostupné.
- Po posledním `at_stop` předpokládá odjezd **po 36 s** u úseků do 75 s, **po 40 s** u úseků do 135 s, jinak **po 45 s**. Při dostupném zpoždění se nesmí přepnout před odhadovaným odjezdem `čas JŘ + zpoždění + 10 s`. Jde o první **heuristické** prahy vycházející z malého počtu záznamů, nikoliv o naučený model přesně určující skutečný odjezd.
- Podmínky: odpověď API do 45 s, původní hlášení maximálně 100 s staré, dvojice navazujících stop sequences, existující další zastávka, žádný odklon či stale stav. Pořadí zastávek se nenavyšuje o více než jednu bez nového potvrzení; přepnutí může být označené jako **predikované**.
- Predikce se vypíná během čekání na konečné; po příchodu skutečného `on_track` nebo nové zastávky z Golemia se opíráme o potvrzená data. Při dočasném opakování stejného staršího hlášení nedochází k blikání zpět.
- V diagnostice je možné vidět čas od `at_stop`, práh 36/40/45 s, predikovaný index a zdroj rozhodnutí. Ve výstupním JSON se změna projevuje mezi událostmi `decision`. Na hlavní obrazovce odhadovanou zastávku označuje nenápadná **oranžová stavová tečka**; názvy a časy zůstávají minimalistické.

**Audit animace `src/StopBoard.tsx`:**
- Dříve byl hlavní řádek mimo DOM seznam ostatních zastávek, takže se jednotlivé elementy nedaly plynule přesouvat jako jeden seznam. Při přepnutí se ještě vytvářela separátní neúplná kopie předchozího řádku; výsledkem mohl být vizuálně nesouvislý přesun či překrývání.
- Nově jsou hlavní i následující zastávky **sourozenecké řádky ve stejném kontejneru**, se stabilním identifikátorem podle indexu tripu. Pro sousední přepnutí používají animaci FLIP (`translateY`, 720 ms). Dřívější hlavní řádek krátce odjede nahoru jako nepřekážející dekorativní kopie. Ruční skok, změna tripu a nastavení `prefers-reduced-motion` plynulý přesun nepoužívají.
- Zobrazení časů je nadále v jedné pravé ose a červená/zelená barva má **výhradně časový význam**.

**Limitace:** Bez přímé polohy telefonu na palubě nemůže aplikace spolehlivě potvrdit skutečný okamžik rozjezdu z pravidelných sporadických zpráv Golemia. Predikce proto může v některých situacích přepnout před odjezdem nebo později, zejména při delším stání na zastávce, dopravní nepravidelnosti nebo změně intervalů aktualizace. Pro definitivní kalibraci je vhodný další záznam z několika linek; UI výslovně odlišuje predikci od potvrzení. 


## Struktura aplikace po refaktoringu (listopad 2026)

- `src/main.tsx`: inicializace Reactu.
- `src/AppView.tsx`, `src/StopBoard.tsx`, `src/Diagnostics.tsx`: vykreslování.
- `src/useAppController.ts`: koordinace obrazovky a výpočtu aktuálního stavu.
- `src/useOrderLookup.ts`: nabídka spojů; seskupování podle linky a pořadí je memoizované, nemusí se opakovat každou sekundu.
- `src/useVehicleTracking.ts`: živá data Golemia, obnovování a známý vůz.
- `src/useGpsTracking.ts`: sledování GPS a preference.
- `src/useChainTracking.ts` a `src/useChainHandoff.ts`: sledování návazných linek a jejich přepínání.
- `src/chainHandoff.ts`, `src/tripSelection.ts`, `src/remoteProgress.ts`: pravidla výběru tripu, návaznosti a odhadu postupu.
- `src/featureUtils.ts`: společné přístupy k polím vozidel Golemia.
- `src/trackingStorage.ts`: uložení a vypršení aktivního sledování.

`npm test` zahrnuje scénáře změny vozu a pořadí, přechody mezi řetězenými linkami a odhad přepnutí zastávek bez GPS. `npm run build` zároveň kontroluje TypeScript.

GitHub Actions **Verify Časovač** ověřuje změny před sloučením i na větvi `main`; **Deploy Časovač** sestaví produkci pomocí `npm ci`, používá cache npm a denní cache statických GTFS dat. Výpadek stažení GTFS nemá vést k nasazení neúplné aplikace.

**Provozní kontrola před dalšími změnami:** automatické testy neověřují fungování telefonu na pozadí ani konkrétní reálnou posloupnost hlášení vozidla. Při úpravách GPS a řetězení zaznamenávej reálné testovací jízdy a ověřuj na mobilu.
