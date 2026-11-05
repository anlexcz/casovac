# Časovač 0.7

Mobilní webová pomůcka pro sledování tramvajového pořadí PID. React, TypeScript, Vite a GitHub Pages.

## Používání

1. V **Nastavení** vlož osobní Golemio API klíč. Volitelně zaškrtni jeho zapamatování.
2. Zadej linku a pořadí (například `25/5`) a klikni na **Sledovat**.
3. Na hlavní stránce se zobrazí přiřazené vozidlo, zastávka, plánovaný odjezd, odpočet a několik okolních zastávek.
4. GPS lze zapnout a vypnout v horní liště. Prohlížeč si pamatuje preferenci; při novém otevření se pokusí získávání polohy spustit znovu, pokud to oprávnění a pravidla Androidu dovolí.
5. Plovoucí tlačítko otevře **Diagnostiku**, kde zůstávají původní technická data a ruční výběr tripu.

Poslední zadané `linka/pořadí` se uchovává místně. Sledování se po novém otevření **nespouští automaticky**, vyžaduje potvrzení tlačítkem.

## Princip

- Živá vozidla z Golemio vehiclepositions každých 20 sekund.
- Pořadí primárně přes `trip.sequence_id`.
- Zastávky a časy z Golemio GTFS Lookup podle aktuálního `trip_id` (nikoli stažený ZIP soubor).
- GPS porovnává telefon s polohou vozidla a očekávanou zastávkou. Dvě po sobě jdoucí měření s rozestupem 3 sekund, dostatečná přesnost a poloha kompatibilní s Golemiem jsou potřebné k potvrzení zastávky.
- Manuální korekce zastávky je k dispozici na hlavní obrazovce i v diagnostice.
- Odpočet je pouze vůči **plánovanému času odjezdu**, při překročení času pokračuje záporně. Nejde o výpočet skutečného oprávnění k odjezdu.

## Soukromí

API token se ukládá do `localStorage` **pouze s výslovným zapamatováním**. To není bezpečný trezor; na sdílených zařízeních volbu nepoužívej. Bez zapamatování je token jen v paměti stránky. Poloha telefonu se používá lokálně ve webu a neodesílá se na vlastní server. Volání Golemia používají token v hlavičce `X-Access-Token`.

## Vývoj

```sh
npm install
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
