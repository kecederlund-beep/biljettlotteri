# Biljettlotteri - Lulea Hockey (MVP)

En fungerande MVP byggd i Next.js + Prisma for medlemsbaserat biljettlotteri med:

- publik lotterisida per match
- verifiering mot medlemsregister synkat fran Google Sheets
- timer till stangning/dragning
- live ticker med antal deltagare
- adminpanel for att skapa och hantera lotterier
- manuell stangning, dragning av vinnare och publicering
- publik visning av vinnande medlemsnummer

## Nytt: iTarget-verifiering i realtid

- Medlemskontroll sker server-side mot iTarget vid anmalan.
- Status som hanteras: `eligible`, `not_member`, `unknown`, `ambiguous`.
- Endast `eligible` far registreras i lotteriet.
- Ej medlem far tydligt meddelande och lank till medlemssida.
- API-nycklar/token exponeras aldrig i frontend.

## 1. Teknisk arkitektur

### Frontend
- Next.js App Router (`src/app`)
- Publik sida: `/raffles/[slug]`
- Adminpanel: `/admin`
- Klientkomponenter for realtidsupplevelse:
  - `CountdownTimer`
  - `LiveTicker` (polling var 5:e sekund)
  - `EntryForm`

### Backend
- API routes:
  - `POST /api/raffles/[slug]/enter` (registrering + iTarget-verifiering + rate limit)
  - `POST /api/lottery/member-check` (fristende medlemskontroll)
  - `GET /api/raffles/[slug]/count` (ticker)
- Server actions (admin):
  - skapa lotteri
  - uppdatera Google Sheets-kalla
  - synka medlemsregister
  - stanga lotteri
  - satta status
  - dra vinnare
  - publicera vinnare
  - markera deltagare ogiltig

### Databas
- Prisma + PostgreSQL (Supabase)
- Lokal DB-caching av medlemsregister
- Statusdriven domanmodell for lotterifloden

### Integrationslager
- Google Sheets import via:
  - Sheets API v4 (om API-nyckel finns)
  - fallback via `gviz` for publika sheets

## 2. Datamodell / schema

Schema finns i [`prisma/schema.prisma`](./prisma/schema.prisma) med dessa huvudtabeller:

- `Raffle`
  - matchdata, tider, status, antal vinnare, publiceringsflagga
- `RaffleEntry`
  - deltagare per lotteri, verifieringsstatus
  - unik regel: `@@unique([raffleId, membershipNumber])`
- `MembershipRegistry`
  - lokal cache av medlemsregister
- `RaffleWinner`
  - vinnare kopplad till lotteri + entry
- `MembershipSourceConfig`
  - konfiguration och synkstatus for Google Sheets
- `RateLimitEvent`
  - enkel anti-spam for registreringsendpoint
- `AdminAuditLog`
  - logg av admin/systematgarder

## 3. Flode for Google Sheets-synk

1. Admin anger `sheetId`, `sheetTab`, ev. `apiKey` i adminpanelen.
2. Admin klickar "Synka medlemsregister nu".
3. Systemet hamtar rader fran Google Sheets.
4. Header-mappning sker dynamiskt (medlemsnummer/efternamn/telefon/status).
5. Telefon normaliseras till sista 7 siffror.
6. Medlemmar upsertas i `MembershipRegistry`.
7. Senaste synktid, status och importerat antal sparas i `MembershipSourceConfig`.
8. Vid fel sparas felstatus och systemet fortsetter anvanda senast cachelagrade medlemsdata.

## 4. Kodstruktur

```text
src/
  app/
    page.tsx
    raffles/[slug]/page.tsx
    api/raffles/[slug]/count/route.ts
    api/raffles/[slug]/enter/route.ts
    admin/
      page.tsx
      actions.ts
      login/
        page.tsx
        actions.ts
      raffles/[id]/
        page.tsx
        export/route.ts
  components/
    CountdownTimer.tsx
    EntryForm.tsx
    LiveTicker.tsx
  lib/
    admin-session.ts
    auth.ts
    draw.ts
    format.ts
    google-sheets.ts
    membership.ts
    normalize.ts
    prisma.ts
    raffle.ts
    raffle-state.ts
    rate-limit.ts
    statuses.ts
prisma/
  schema.prisma
  seed.ts
```

## 5. UI-komponenter (publik + admin)

### Publik
- Hero med matchnamn, datum, arena, statusbadge
- Stor nedrakning till oppning/stangning/dragning
- Live ticker (antal verifierade deltagare)
- Tydligt anmalningsformular
- Tydliga state-paneler:
  - ej oppnat
  - oppet
  - stangt, vantar pa dragning
  - avgjort med vinnare

### Admin
- Inloggning via losenord + sessionscookie
- Registerpanel for Google Sheets-kalla och synk
- Form for att skapa lotteri
- Lotterioversikt med status, antal deltagare/vinnare, atgardsknappar
- Deltagarlista med CSV-export och manuell invalidering

## 6. Verifieringslogik

Implementerad i [`src/lib/itarget.ts`](./src/lib/itarget.ts) och kopplad i [`src/app/api/raffles/[slug]/enter/route.ts`](./src/app/api/raffles/[slug]/enter/route.ts):

- All iTarget-kommunikation sker server-side med Bearer token.
- Sokordning:
  1. `findBySsn`
  2. `findByEmail`
  3. `findByPhone`
- Kontakt verifieras sedan via:
  - `GET /clients/{clientId}/contacts/{id}`
  - och fallback `GET /clients/{clientId}/contacts/{id}/memberships`
- Returnerar standardstatus:
  - `eligible`
  - `not_member`
  - `unknown`
  - `ambiguous`
- Timeout, retry, kort cache-TTL och rate limiting ar inbyggt.

## 7. Logik for dragning av vinnare

Implementerad i [`src/lib/draw.ts`](./src/lib/draw.ts):

1. Auto-stangning kor innan dragning.
2. Endast `VERIFIED` entries ar kandidater.
3. Rattvis slumpning goras med `crypto.randomInt` (Fisher-Yates shuffle).
4. Antal vinnare = `min(numberOfWinners, antal verifierade kandidater)`.
5. Vinnare sparas i `RaffleWinner`.
6. Lotteriet markeras `RESOLVED` men vinnare publiceras separat.

## 8. Realtime: timer och ticker

### Timer
- Klientkomponent med uppdatering varje sekund.
- Sidan visar nedrakning till relevant tid beroende pa state.

### Ticker
- Polling mot `GET /api/raffles/[slug]/count` var 5:e sekund.
- Visar verifierade deltagare utan manuell omladdning.

## 9. Automatisk + manuell stangning

### Automatisk
- `closeExpiredRaffles()` uppdaterar `ACTIVE -> CLOSED` nar `closeAt` passerat.
- Kallas innan publik lasning, count-endpoint, registrering och dragning.

### Manuell
- Adminknapp "Stang nu" satter:
  - `status = CLOSED`
  - `closeAt = now`

## 10. Forsta fungerande MVP (hur du kor)

1. Installera beroenden

```bash
npm install
```

2. Konfigurera miljo (`.env`)

```env
# Supabase pooler (for app runtime)
DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
# Supabase direct (for Prisma CLI)
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?sslmode=require"
ADMIN_PASSWORD="byt-hemligt-losenord"
ADMIN_SESSION_SECRET="byt-hemlig-session"
ITARGET_API_BASE="https://app.itarget.se/api"
ITARGET_CLIENT_ID="274"
ITARGET_TOKEN="..."
MEMBERSHIP_SIGNUP_URL="https://luleahockey.propublik.se/medlem"
# Valfritt
ITARGET_TIMEOUT_MS="7000"
ITARGET_RETRIES="1"
ITARGET_CACHE_TTL_MS="30000"
# Endast om iTarget anvander annat request-faltnamn
ITARGET_EMAIL_FIELD="email"
# Legacy/valfritt om ni fortsatt vill anvanda Google Sheets-delar i admin
GOOGLE_SHEETS_ID="..."
GOOGLE_SHEETS_TAB="Medlemmar"
GOOGLE_SHEETS_API_KEY="..."
```

3. Skapa databas-schema i Supabase

```bash
npx prisma generate
npx prisma db push
```

4. Seeda exempeldata (valfritt)

```bash
npm run seed
```

5. Starta app

```bash
npm run dev
```

6. Oppna
- Publik startsida: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin/login`

## Cloudflare Pages: Variables and Secrets

Lagg dessa i **Settings -> Variables and Secrets** for bade `Production` och `Preview`:

- `ADMIN_PASSWORD` (secret)
- `ADMIN_SESSION_SECRET` (secret)
- `ITARGET_API_BASE`
- `ITARGET_CLIENT_ID`
- `ITARGET_TOKEN` (secret)
- `MEMBERSHIP_SIGNUP_URL`
- `DATABASE_URL` (Supabase pooled connection string)
- `DIRECT_URL` (Supabase direct connection string)

## Deploy till Cloudflare utan GitHub?

Kort svar: inte for den har appen som den ar byggd nu.

- Drag-and-drop i Pages funkar bra for statiska sajter.
- Den har appen ar dynamisk (API routes, server actions, databas), sa den behover en riktig build/deploy-pipeline.
- Rekommenderat: koppla ett GitHub-repo till Cloudflare Pages eller deploya via Wrangler/OpenNext.

## Supabase setup (steg for steg)

1. Skapa ett projekt i Supabase.
2. Ga till `Project Settings -> Database -> Connection string`.
3. Hamta tva connection strings:
   - pooled/supavisor -> `DATABASE_URL`
   - direct -> `DIRECT_URL`
4. Uppdatera `.env` lokalt och Cloudflare Pages secrets med dessa varden.
5. Kor lokalt:

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

6. Verifiera att admin och publik sida funkar lokalt.
7. Deploy till Cloudflare och kor samma env i `Preview` + `Production`.

## Sakerhet och integritet i MVP

- Endast `phone_last7` lagras i deltagardata
- Generiska verifieringsfel (ingen detaljlagecka)
- Enkel rate limiting pa registreringsendpoint
- Sessioncookie for admin
- Adminatgarder loggas i `AdminAuditLog`

## Vad som ar med / inte med i MVP

### Med
- skapa lotteri
- Google Sheets som registerkalla
- verifiering (medlemsnummer + efternamn + sista 7)
- anmalningsformular
- timer
- ticker
- manuell stangning
- dragning och publicering av vinnare

### Kommande (enkla steg att bygga vidare)
- reservlista
- automatisk publicering vid exakt tid
- mer avancerad rate limiting (Redis)
- rollbaserad admin (flera administratorkonton)
- byte fran Google Sheets till riktigt medlems-API utan att andra verifieringskarnan
