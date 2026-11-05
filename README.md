# Časovač 0.6

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
