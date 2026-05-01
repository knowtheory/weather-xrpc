# Weather XRPC Service — Design

**Date:** 2026-05-01
**Status:** Draft

## Overview

A standalone ATProto XRPC service that accepts an H3 geographic cell ID, fetches weather data from upstream providers (NWS for US, Open-Meteo globally), transforms the results into ATProto lexicon records, stores them in SQLite, and returns them to authenticated callers.

The primary design constraint is **privacy-preserving location disclosure**: callers provide an H3 bin rather than precise coordinates, allowing them to reveal a geographic region without exposing an exact location.

---

## Stack

| Concern | Choice |
|---|---|
| Runtime | TypeScript / Node.js |
| XRPC layer | `@atproto/xrpc-server` (Express middleware, lexicon validation) |
| Auth | ATProto DID authentication via `@atproto/identity` |
| Storage | SQLite via `better-sqlite3` |
| Geographic binning | H3 hexagonal grid via `h3-js` |
| Solar times | `suncalc` |
| Lexicon namespace | `garden.lexicon.surprising-scallop.*` (dev) → `cloud.errant.*` (prod) |

---

## Geographic Binning

Callers identify their location by H3 cell ID. H3 cell IDs encode their resolution — the caller chooses their privacy level when generating the cell ID client-side:

- **Resolution 4** — ~40km cell diameter (maximum privacy)
- **Resolution 5** — ~16km (recommended default)
- **Resolution 6** — ~6km (more precise)

The service validates that the provided cell is at resolution 4–6 and rejects anything outside that range. The service computes the H3 cell centroid (`h3.cellToLatLng`) to use as the representative coordinate for provider queries and caches the centroid → provider mapping permanently (it never changes).

H3 was chosen over geohash (non-uniform cell size at high latitudes) and S2 (thinner TS ecosystem) for its globally uniform cell sizes and strong `h3-js` library support.

---

## Weather Providers

The service uses a pluggable `WeatherProvider` interface:

```typescript
interface WeatherProvider {
  name: string
  covers(lat: number, lon: number): boolean
  getObservation(lat: number, lon: number): Promise<ObservationView>
  getForecast(lat: number, lon: number): Promise<ForecastView>
}
```

**Providers:**
- **NWSProvider** — covers US coordinates. Uses NWS `/points/{lat},{lon}` to resolve the grid office + gridX/gridY, then fetches from `/gridpoints/{wfo}/{x},{y}/observations` and `/gridpoints/{wfo}/{x},{y}/forecast`.
- **OpenMeteoProvider** — global fallback for all non-US coordinates.

The router calls `covers()` on each provider in order and uses the first match.

---

## XRPC Procedures

All three procedures are `query` type (HTTP GET) and require DID authentication.

### `getObservation`

Returns current weather conditions for an H3 cell.

**Params:** `{ h3Index: string }`
**Output:** `ObservationView`

```
ObservationView {
  h3Index: string
  observedAt: datetime
  provider: string           // "nws" | "open-meteo"
  stale: boolean             // true if returned from cache during provider outage
  temperature: { value: number, unit: "C" }   // always Celsius; providers normalize internally
  humidity: number           // percent
  windSpeed: { value: number, unit: "km/h" }   // always km/h; providers normalize internally
  windDirection: number?     // degrees 0–360
  conditions: string?        // "Partly Cloudy", "Rain", etc.
  icon: string?              // provider icon URL
}
```

**Cache TTL:** 15 minutes.

### `getForecast`

Returns upcoming forecast periods for an H3 cell.

**Params:** `{ h3Index: string }`
**Output:** `ForecastView`

```
ForecastView {
  h3Index: string
  generatedAt: datetime
  provider: string
  stale: boolean
  periods: array of {
    name: string             // "Tonight", "Wednesday", etc.
    startTime: datetime
    endTime: datetime
    isDaytime: boolean
    temperature: { value: number, unit: "C" }   // always Celsius
    precipProbability: number?   // percent
    windSpeed: { value: number, unit: "km/h" }  // always km/h
    conditions: string?
    detailedForecast: string?    // NWS narrative text; omitted for Open-Meteo
  }
}
```

**Cache TTL:** 1 hour.

### `getSolarTimes`

Returns solar event times for an H3 cell on a given date. Computed from the H3 centroid using `suncalc` — no upstream API call, no caching needed.

**Params:** `{ h3Index: string, date?: string }` — date is ISO 8601 (e.g. `"2026-05-01"`), defaults to today UTC.
**Output:** `SolarTimesView`

```
SolarTimesView {
  h3Index: string
  date: string
  astronomicalDawn: datetime?
  nauticalDawn: datetime?
  dawn: datetime               // civil dawn
  sunrise: datetime
  goldenHourMorningEnd: datetime?
  solarNoon: datetime
  goldenHourEveningStart: datetime?
  sunset: datetime
  dusk: datetime               // civil dusk
  nauticalDusk: datetime?
  astronomicalDusk: datetime?
  nadir: datetime              // darkest point of night
}
```

Nullable fields handle polar edge cases (midnight sun / polar night).

---

## Authentication

All procedures use ATProto DID authentication via an `AuthVerifier` registered per-route with `@atproto/xrpc-server`:

1. Extract `Authorization: Bearer <token>` from the request
2. Decode the JWT service token
3. Resolve the caller's DID via `@atproto/identity`
4. Verify the token signature against the DID's public key
5. Return `{ did: string }` or reject with `AuthRequired`

The caller DID is available in handler context but not used for per-user rate limiting or personalization in v1.

---

## Error Types

| Error | HTTP | Condition |
|---|---|---|
| `AuthRequired` | 401 | Missing or invalid DID token |
| `InvalidH3Index` | 400 | Malformed H3 cell ID |
| `UnsupportedResolution` | 400 | H3 cell resolution outside 4–6 |
| `InvalidDate` | 400 | Unparseable date param in `getSolarTimes` |
| `ProviderUnavailable` | 503 | Upstream returned an error and no cached data exists |
| `ProviderTimeout` | 504 | Upstream request timed out and no cached data exists |

When stale cached data exists and the provider is unavailable, the service returns the stale data with `stale: true` rather than an error (reliability over freshness).

---

## Storage (SQLite)

Three tables:

**`h3_provider_map`** — permanent cache of H3 centroid → provider assignment.
```sql
h3_index TEXT PRIMARY KEY,
provider TEXT NOT NULL,
fetched_at INTEGER NOT NULL
```

**`observations`** — current conditions archive.
```sql
id INTEGER PRIMARY KEY,
h3_index TEXT NOT NULL,
provider TEXT NOT NULL,
fetched_at INTEGER NOT NULL,
payload TEXT NOT NULL   -- JSON lexicon record
```

**`forecasts`** — forecast archive.
```sql
id INTEGER PRIMARY KEY,
h3_index TEXT NOT NULL,
provider TEXT NOT NULL,
fetched_at INTEGER NOT NULL,
payload TEXT NOT NULL   -- JSON lexicon record
```

Rows are never deleted — all historical data is retained. The most recent row per `h3_index` is the cache; older rows are the archive. A unique index on `(h3_index)` with `ON CONFLICT REPLACE` handles cache updates for `h3_provider_map`; `observations` and `forecasts` use separate INSERT + latest-row query.

---

## Project Structure

```
weather_xrpc/
├── lexicons/
│   ├── getObservation.json
│   ├── getForecast.json
│   └── getSolarTimes.json
├── src/
│   ├── providers/
│   │   ├── types.ts          // WeatherProvider interface
│   │   ├── nws.ts            // NWS client + transformer
│   │   ├── open-meteo.ts     // Open-Meteo client + transformer
│   │   └── router.ts         // picks provider by lat/lon
│   ├── handlers/
│   │   ├── getObservation.ts
│   │   ├── getForecast.ts
│   │   └── getSolarTimes.ts
│   ├── db/
│   │   ├── client.ts         // better-sqlite3 setup + migrations
│   │   └── cache.ts          // read/write cache, TTL, stale logic
│   ├── auth.ts               // DID AuthVerifier
│   ├── h3.ts                 // H3 utilities (centroid, validate)
│   └── server.ts             // Express + xrpc-server wiring
├── package.json
└── tsconfig.json
```

Each module has a single clear responsibility. Handlers are the only layer that orchestrates across providers, cache, and H3 — nothing else crosses those boundaries.

---

## Lexicon Publishing

Lexicons are defined as JSON files in `lexicons/` and published to the ATProto PDS as `com.atproto.lexicon.schema` records using `goat lex publish`. Lexicon Garden indexes them for discovery.

**Development namespace:** `garden.lexicon.surprising-scallop.*`
**Production namespace:** `cloud.errant.*` (requires DNS TXT record at `_lexicon.weather.errant.cloud` pointing to the owner DID)
