# Časovač 0.4

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
