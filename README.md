# Časovač – PID

Mobilní webový prototyp hlídače tramvajového pořadí. React + TypeScript + Vite, GitHub Pages.

## Verze 0.1

- Zadání **linka/pořadí** (např. `25/5`).
- Dotaz na `GET https://api.golemio.cz/v2/vehiclepositions?routeShortName=25&limit=1000` s obnovou po 20 s.
- Seznam vozidel, trip ID, případných údajů pořadí a výpis surového GeoJSON.
- Automatický výběr pouze při jediné jednoznačné shodě; jinak ruční výběr konkrétního vozidla.
- Volitelné GPS telefonu: souřadnice, přesnost, rychlost a stáří polohy.
- Golemio klíč pouze v paměti stránky, bez ukládání do repozitáře, localStorage nebo URL.

## Lokální spuštění

```bash
npm install
npm run dev
npm run build
```

GitHub Pages: **Settings → Pages → Build and deployment → GitHub Actions**. Po úspěšném nasazení: https://anlexcz.github.io/casovac/

## Omezení

- Je nutné ověřit přímé browserové volání Golemia s klíčem, zejména CORS. Bez úspěšného preflight bude třeba proxy.
- Názvy polí skutečně používaných pro pořadí musí být ověřeny na reálné odpovědi. `cis.trip_number` není automaticky zaměňováno za pořadí.
- Sledování GPS na pozadí a při zamčeném telefonu nemusí fungovat. GPS se zatím nepoužívá k automatické změně zastávky.
- Není implementováno načtení kompletního jízdního řádu ani hodnocení oprávnění k odjezdu.
- Vložený klíč mohou v běžící stránce potenciálně přečíst škodlivá rozšíření či skripty. Neukládejte ho do issues nebo veřejných logů.
- Aplikace je informační pomůcka, nikdy provozní pokyn.

## Další práce

Ověřit CORS, skutečné pole pořadí a aktuální schema. Pak přidat GTFS Lookup, posloupnost zastávek a map matching GPS.
