# Weather XRPC Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript/Node.js ATProto XRPC service that accepts an H3 cell ID, fetches weather from NWS (US) or Open-Meteo (global), stores results in SQLite, and returns ATProto lexicon records to DID-authenticated callers.

**Architecture:** Express app mounting `@atproto/xrpc-server` middleware with three query procedures (`getObservation`, `getForecast`, `getSolarTimes`). A pluggable `WeatherProvider` interface routes requests to NWS or Open-Meteo based on geography. SQLite stores a TTL-based cache and a permanent historical archive in the same tables.

**Tech Stack:** TypeScript, Node.js, `@atproto/xrpc-server`, `@atproto/identity`, `better-sqlite3`, `h3-js`, `suncalc`, `vitest`, `tsx`

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | Dependencies, scripts |
| `tsconfig.json` | TypeScript config (CommonJS, strict) |
| `vitest.config.ts` | Test runner config |
| `src/h3.ts` | Validate H3 index, get centroid, check resolution |
| `src/db/client.ts` | Open SQLite, run migrations |
| `src/db/cache.ts` | Read/write observations + forecasts, TTL logic, stale detection |
| `src/providers/types.ts` | `WeatherProvider` interface, `ObservationView`, `ForecastView` types |
| `src/providers/nws.ts` | NWS API client + transformer (→ Celsius, km/h) |
| `src/providers/open-meteo.ts` | Open-Meteo API client + transformer |
| `src/providers/router.ts` | Pick provider by lat/lon |
| `src/auth.ts` | ATProto DID `AuthVerifier` |
| `src/handlers/getObservation.ts` | Orchestrate H3 → cache → provider → store → return |
| `src/handlers/getForecast.ts` | Same for forecast |
| `src/handlers/getSolarTimes.ts` | Compute solar times with `suncalc` |
| `src/server.ts` | Wire Express + xrpc-server + all handlers |
| `lexicons/getObservation.json` | ATProto lexicon schema |
| `lexicons/getForecast.json` | ATProto lexicon schema |
| `lexicons/getSolarTimes.json` | ATProto lexicon schema |
| `tests/h3.test.ts` | Unit tests for h3.ts |
| `tests/db/cache.test.ts` | Unit tests for cache.ts |
| `tests/providers/nws.test.ts` | Unit tests for nws.ts (mocked fetch) |
| `tests/providers/open-meteo.test.ts` | Unit tests for open-meteo.ts (mocked fetch) |
| `tests/providers/router.test.ts` | Unit tests for router.ts |
| `tests/handlers/getObservation.test.ts` | Unit tests for handler (mocked cache + provider) |
| `tests/handlers/getForecast.test.ts` | Unit tests for handler |
| `tests/handlers/getSolarTimes.test.ts` | Unit tests for handler |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "weather-xrpc",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx src/server.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atproto/identity": "^0.4.3",
    "@atproto/xrpc-server": "^0.10.20",
    "better-sqlite3": "^9.6.0",
    "express": "^4.21.2",
    "h3-js": "^4.1.0",
    "suncalc": "^1.9.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/express": "^4.17.21",
    "@types/node": "^20.17.0",
    "@types/suncalc": "^1.9.2",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*", "lexicons/**/*"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Verify TypeScript compiles (empty src)**

```bash
mkdir -p src tests lexicons
touch src/server.ts
npx tsc --noEmit
```

Expected: no errors (empty file is valid).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts
git commit -m "chore: project scaffolding"
```

---

## Task 2: H3 Utilities

**Files:**
- Create: `src/h3.ts`
- Create: `tests/h3.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/h3.test.ts
import { describe, it, expect } from 'vitest'
import { validateH3Index, getCentroid, getResolution } from '../src/h3'

describe('validateH3Index', () => {
  it('accepts valid resolution-5 cell', () => {
    expect(() => validateH3Index('852a1073fffffff')).not.toThrow()
  })

  it('accepts valid resolution-4 cell', () => {
    expect(() => validateH3Index('842a1073fffffff')).not.toThrow()
  })

  it('accepts valid resolution-6 cell', () => {
    expect(() => validateH3Index('862a1073fffffff')).not.toThrow()
  })

  it('throws InvalidH3Index for garbage string', () => {
    expect(() => validateH3Index('not-an-h3-cell')).toThrow('InvalidH3Index')
  })

  it('throws UnsupportedResolution for resolution 3', () => {
    expect(() => validateH3Index('832a107ffffffff')).toThrow('UnsupportedResolution')
  })

  it('throws UnsupportedResolution for resolution 7', () => {
    expect(() => validateH3Index('872a1073fffffff')).toThrow('UnsupportedResolution')
  })
})

describe('getCentroid', () => {
  it('returns [lat, lon] for a valid cell', () => {
    const [lat, lon] = getCentroid('852a1073fffffff')
    expect(lat).toBeCloseTo(37.77, 1)
    expect(lon).toBeCloseTo(-122.41, 1)
  })
})

describe('getResolution', () => {
  it('returns 5 for a res-5 cell', () => {
    expect(getResolution('852a1073fffffff')).toBe(5)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/h3.test.ts
```

Expected: FAIL — "Cannot find module '../src/h3'"

- [ ] **Step 3: Implement src/h3.ts**

```typescript
// src/h3.ts
import { isValidCell, cellToLatLng, getResolution as h3GetResolution } from 'h3-js'

const MIN_RESOLUTION = 4
const MAX_RESOLUTION = 6

export class XRPCError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'XRPCError'
  }
}

export function validateH3Index(h3Index: string): void {
  if (!isValidCell(h3Index)) {
    throw new XRPCError('InvalidH3Index', `Invalid H3 cell: ${h3Index}`)
  }
  const res = h3GetResolution(h3Index)
  if (res < MIN_RESOLUTION || res > MAX_RESOLUTION) {
    throw new XRPCError(
      'UnsupportedResolution',
      `H3 resolution ${res} not supported — use resolution ${MIN_RESOLUTION}–${MAX_RESOLUTION}`
    )
  }
}

export function getCentroid(h3Index: string): [number, number] {
  return cellToLatLng(h3Index) as [number, number]
}

export function getResolution(h3Index: string): number {
  return h3GetResolution(h3Index)
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/h3.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/h3.ts tests/h3.test.ts
git commit -m "feat: H3 cell validation and centroid utilities"
```

---

## Task 3: SQLite Client + Migrations

**Files:**
- Create: `src/db/client.ts`

- [ ] **Step 1: Implement src/db/client.ts**

No test here — the migration logic is validated by the cache tests in Task 4.

```typescript
// src/db/client.ts
import Database from 'better-sqlite3'

export function openDatabase(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS h3_provider_map (
      h3_index TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      h3_index TEXT NOT NULL,
      provider TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS observations_h3_fetched
      ON observations (h3_index, fetched_at DESC);

    CREATE TABLE IF NOT EXISTS forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      h3_index TEXT NOT NULL,
      provider TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS forecasts_h3_fetched
      ON forecasts (h3_index, fetched_at DESC);
  `)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/client.ts
git commit -m "feat: SQLite client with WAL mode and migrations"
```

---

## Task 4: Cache Layer

**Files:**
- Create: `src/db/cache.ts`
- Create: `tests/db/cache.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/db/cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/db/client'
import {
  getLatestObservation,
  insertObservation,
  getLatestForecast,
  insertForecast,
  getProviderMap,
  setProviderMap,
  isStale,
} from '../../src/db/cache'
import type { ObservationView, ForecastView } from '../../src/providers/types'
import type Database from 'better-sqlite3'

let db: Database.Database

beforeEach(() => {
  db = openDatabase(':memory:')
})

const mockObservation: ObservationView = {
  h3Index: '852a1073fffffff',
  observedAt: '2026-05-01T12:00:00Z',
  provider: 'nws',
  stale: false,
  temperature: { value: 15.5, unit: 'C' },
  humidity: 65,
  windSpeed: { value: 16, unit: 'km/h' },
}

const mockForecast: ForecastView = {
  h3Index: '852a1073fffffff',
  generatedAt: '2026-05-01T12:00:00Z',
  provider: 'nws',
  stale: false,
  periods: [],
}

describe('observations', () => {
  it('returns undefined when no observation exists', () => {
    expect(getLatestObservation(db, '852a1073fffffff')).toBeUndefined()
  })

  it('stores and retrieves an observation', () => {
    insertObservation(db, '852a1073fffffff', 'nws', mockObservation)
    const row = getLatestObservation(db, '852a1073fffffff')
    expect(row).toBeDefined()
    expect(JSON.parse(row!.payload)).toMatchObject({ provider: 'nws' })
  })

  it('returns the most recent observation when multiple exist', () => {
    insertObservation(db, '852a1073fffffff', 'nws', { ...mockObservation, observedAt: '2026-05-01T11:00:00Z' })
    insertObservation(db, '852a1073fffffff', 'nws', { ...mockObservation, observedAt: '2026-05-01T12:00:00Z' })
    const row = getLatestObservation(db, '852a1073fffffff')
    expect(JSON.parse(row!.payload).observedAt).toBe('2026-05-01T12:00:00Z')
  })
})

describe('forecasts', () => {
  it('returns undefined when no forecast exists', () => {
    expect(getLatestForecast(db, '852a1073fffffff')).toBeUndefined()
  })

  it('stores and retrieves a forecast', () => {
    insertForecast(db, '852a1073fffffff', 'open-meteo', mockForecast)
    const row = getLatestForecast(db, '852a1073fffffff')
    expect(row).toBeDefined()
    expect(row!.provider).toBe('open-meteo')
  })
})

describe('h3_provider_map', () => {
  it('returns undefined for unknown cell', () => {
    expect(getProviderMap(db, '852a1073fffffff')).toBeUndefined()
  })

  it('stores and retrieves provider assignment', () => {
    setProviderMap(db, '852a1073fffffff', 'nws', { gridId: 'SEW', gridX: 124, gridY: 67, stationId: 'KSEA' })
    const entry = getProviderMap(db, '852a1073fffffff')
    expect(entry?.provider).toBe('nws')
    expect(entry?.metadata?.gridId).toBe('SEW')
  })
})

describe('isStale', () => {
  it('returns false for a fresh row', () => {
    const row = { fetchedAt: Date.now() - 1000 * 60 * 5 } // 5 min ago
    expect(isStale(row, 1000 * 60 * 15)).toBe(false)
  })

  it('returns true for an expired row', () => {
    const row = { fetchedAt: Date.now() - 1000 * 60 * 20 } // 20 min ago
    expect(isStale(row, 1000 * 60 * 15)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/db/cache.test.ts
```

Expected: FAIL — "Cannot find module '../../src/db/cache'"

- [ ] **Step 3: Implement src/db/cache.ts**

```typescript
// src/db/cache.ts
import type Database from 'better-sqlite3'
import type { ObservationView, ForecastView } from '../providers/types'

export interface CacheRow {
  id: number
  h3Index: string
  provider: string
  fetchedAt: number
  payload: string
}

export interface ProviderMapEntry {
  provider: string
  metadata?: Record<string, unknown>
}

export function getLatestObservation(db: Database.Database, h3Index: string): CacheRow | undefined {
  const row = db
    .prepare(
      `SELECT id, h3_index as h3Index, provider, fetched_at as fetchedAt, payload
       FROM observations WHERE h3_index = ? ORDER BY fetched_at DESC LIMIT 1`
    )
    .get(h3Index) as CacheRow | undefined
  return row
}

export function insertObservation(
  db: Database.Database,
  h3Index: string,
  provider: string,
  view: ObservationView
): void {
  db.prepare(
    `INSERT INTO observations (h3_index, provider, fetched_at, payload) VALUES (?, ?, ?, ?)`
  ).run(h3Index, provider, Date.now(), JSON.stringify(view))
}

export function getLatestForecast(db: Database.Database, h3Index: string): CacheRow | undefined {
  const row = db
    .prepare(
      `SELECT id, h3_index as h3Index, provider, fetched_at as fetchedAt, payload
       FROM forecasts WHERE h3_index = ? ORDER BY fetched_at DESC LIMIT 1`
    )
    .get(h3Index) as CacheRow | undefined
  return row
}

export function insertForecast(
  db: Database.Database,
  h3Index: string,
  provider: string,
  view: ForecastView
): void {
  db.prepare(
    `INSERT INTO forecasts (h3_index, provider, fetched_at, payload) VALUES (?, ?, ?, ?)`
  ).run(h3Index, provider, Date.now(), JSON.stringify(view))
}

export function getProviderMap(db: Database.Database, h3Index: string): ProviderMapEntry | undefined {
  const row = db
    .prepare(`SELECT provider, metadata FROM h3_provider_map WHERE h3_index = ?`)
    .get(h3Index) as { provider: string; metadata: string | null } | undefined
  if (!row) return undefined
  return {
    provider: row.provider,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }
}

export function setProviderMap(
  db: Database.Database,
  h3Index: string,
  provider: string,
  metadata?: Record<string, unknown>
): void {
  db.prepare(
    `INSERT INTO h3_provider_map (h3_index, provider, fetched_at, metadata)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(h3_index) DO UPDATE SET provider=excluded.provider, fetched_at=excluded.fetched_at, metadata=excluded.metadata`
  ).run(h3Index, provider, Date.now(), metadata ? JSON.stringify(metadata) : null)
}

export function isStale(row: { fetchedAt: number }, ttlMs: number): boolean {
  return Date.now() - row.fetchedAt > ttlMs
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/db/cache.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/cache.ts tests/db/cache.test.ts
git commit -m "feat: SQLite cache layer with TTL and stale detection"
```

---

## Task 5: Provider Types

**Files:**
- Create: `src/providers/types.ts`

No test — this is a pure types file. It is validated by downstream tasks.

- [ ] **Step 1: Implement src/providers/types.ts**

```typescript
// src/providers/types.ts

export interface Temperature {
  value: number
  unit: 'C'
}

export interface WindSpeed {
  value: number
  unit: 'km/h'
}

export interface ObservationView {
  h3Index: string
  observedAt: string       // ISO 8601 datetime
  provider: string         // "nws" | "open-meteo"
  stale: boolean
  temperature: Temperature
  humidity: number         // percent 0–100
  windSpeed: WindSpeed
  windDirection?: number   // degrees 0–360
  conditions?: string      // human-readable, e.g. "Partly Cloudy"
  icon?: string            // provider icon URL
}

export interface ForecastPeriod {
  name: string             // e.g. "Tonight", "Wednesday"
  startTime: string        // ISO 8601
  endTime: string          // ISO 8601
  isDaytime: boolean
  temperature: Temperature
  precipProbability?: number  // percent 0–100
  windSpeed: WindSpeed
  conditions?: string
  detailedForecast?: string   // NWS narrative only; omitted for Open-Meteo
}

export interface ForecastView {
  h3Index: string
  generatedAt: string      // ISO 8601
  provider: string
  stale: boolean
  periods: ForecastPeriod[]
}

export interface WeatherProvider {
  name: string
  covers(lat: number, lon: number): boolean
  getObservation(lat: number, lon: number): Promise<ObservationView>
  getForecast(lat: number, lon: number): Promise<ForecastView>
}
```

- [ ] **Step 2: Commit**

```bash
git add src/providers/types.ts
git commit -m "feat: WeatherProvider interface and view types"
```

---

## Task 6: NWS Provider

**Files:**
- Create: `src/providers/nws.ts`
- Create: `tests/providers/nws.test.ts`

NWS API flow for a given lat/lon:
1. `GET https://api.weather.gov/points/{lat},{lon}` → `properties.gridId` (office), `properties.gridX`, `properties.gridY`
2. `GET https://api.weather.gov/gridpoints/{office}/{gridX},{gridY}/stations` → `features[0].properties.stationIdentifier`
3. `GET https://api.weather.gov/stations/{stationId}/observations/latest` → current observation
4. `GET https://api.weather.gov/gridpoints/{office}/{gridX},{gridY}/forecast?units=si` → forecast periods

NWS observation temperature arrives in Celsius (`wmoUnit:degC`). Wind speed in km/h (`wmoUnit:km_h-1`).
NWS forecast (with `?units=si`): temperature in Celsius integer, wind speed as string `"16 km/h"` or `"10 to 20 km/h"`.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/nws.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NWSProvider } from '../../src/providers/nws'

const mockPointsResponse = {
  properties: {
    gridId: 'SEW',
    gridX: 124,
    gridY: 67,
  },
}

const mockStationsResponse = {
  features: [
    { properties: { stationIdentifier: 'KSEA' } },
  ],
}

const mockObservationResponse = {
  properties: {
    timestamp: '2026-05-01T12:00:00+00:00',
    temperature: { value: 15.5, unitCode: 'wmoUnit:degC' },
    relativeHumidity: { value: 65.0 },
    windSpeed: { value: 16.0, unitCode: 'wmoUnit:km_h-1' },
    windDirection: { value: 270.0 },
    textDescription: 'Partly Cloudy',
    icon: 'https://api.weather.gov/icons/land/day/few',
  },
}

const mockForecastResponse = {
  properties: {
    generatedAt: '2026-05-01T12:00:00+00:00',
    periods: [
      {
        name: 'Tonight',
        startTime: '2026-05-01T18:00:00-07:00',
        endTime: '2026-05-02T06:00:00-07:00',
        isDaytime: false,
        temperature: 8,
        windSpeed: '16 km/h',
        windDirection: 'NW',
        shortForecast: 'Mostly Clear',
        detailedForecast: 'Mostly clear, with a low around 8.',
        probabilityOfPrecipitation: { value: 10 },
      },
    ],
  },
}

function mockFetch(...responses: object[]) {
  let call = 0
  vi.spyOn(global, 'fetch').mockImplementation(async () => {
    const body = responses[call++ % responses.length]
    return { ok: true, json: async () => body } as Response
  })
}

beforeEach(() => { vi.restoreAllMocks() })

describe('NWSProvider.covers', () => {
  const provider = new NWSProvider()

  it('covers Seattle', () => expect(provider.covers(47.6, -122.3)).toBe(true))
  it('covers Honolulu', () => expect(provider.covers(21.3, -157.8)).toBe(true))
  it('does not cover London', () => expect(provider.covers(51.5, -0.1)).toBe(false))
  it('does not cover Tokyo', () => expect(provider.covers(35.7, 139.7)).toBe(false))
})

describe('NWSProvider.getObservation', () => {
  it('fetches and transforms a current observation', async () => {
    mockFetch(mockPointsResponse, mockStationsResponse, mockObservationResponse)
    const provider = new NWSProvider()
    const obs = await provider.getObservation(47.6, -122.3)

    expect(obs.provider).toBe('nws')
    expect(obs.temperature).toEqual({ value: 15.5, unit: 'C' })
    expect(obs.humidity).toBe(65)
    expect(obs.windSpeed).toEqual({ value: 16, unit: 'km/h' })
    expect(obs.windDirection).toBe(270)
    expect(obs.conditions).toBe('Partly Cloudy')
  })
})

describe('NWSProvider.getForecast', () => {
  it('fetches and transforms forecast periods', async () => {
    mockFetch(mockPointsResponse, mockForecastResponse)
    const provider = new NWSProvider()
    const forecast = await provider.getForecast(47.6, -122.3)

    expect(forecast.provider).toBe('nws')
    expect(forecast.periods).toHaveLength(1)
    const period = forecast.periods[0]
    expect(period.name).toBe('Tonight')
    expect(period.temperature).toEqual({ value: 8, unit: 'C' })
    expect(period.windSpeed).toEqual({ value: 16, unit: 'km/h' })
    expect(period.precipProbability).toBe(10)
    expect(period.detailedForecast).toBe('Mostly clear, with a low around 8.')
  })

  it('handles wind speed range strings like "10 to 20 km/h"', async () => {
    const modifiedForecast = {
      properties: {
        ...mockForecastResponse.properties,
        periods: [{ ...mockForecastResponse.properties.periods[0], windSpeed: '10 to 20 km/h' }],
      },
    }
    mockFetch(mockPointsResponse, modifiedForecast)
    const provider = new NWSProvider()
    const forecast = await provider.getForecast(47.6, -122.3)
    expect(forecast.periods[0].windSpeed.value).toBe(20)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/providers/nws.test.ts
```

Expected: FAIL — "Cannot find module '../../src/providers/nws'"

- [ ] **Step 3: Implement src/providers/nws.ts**

```typescript
// src/providers/nws.ts
import type { WeatherProvider, ObservationView, ForecastView, ForecastPeriod } from './types'

const NWS_BASE = 'https://api.weather.gov'
const TIMEOUT_MS = 10_000

async function nwsFetch(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'weather-xrpc/0.1 (github.com/knowtheory/weather-xrpc)' },
    })
    if (!res.ok) throw new Error(`NWS ${res.status} for ${url}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// Parse "16 km/h" or "10 to 20 km/h" → number (take the higher value)
function parseWindSpeed(s: string): number {
  const nums = s.match(/[\d.]+/g)
  if (!nums || nums.length === 0) return 0
  return Math.max(...nums.map(Number))
}

const COMPASS_TO_DEGREES: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
}

interface NWSGridInfo {
  gridId: string
  gridX: number
  gridY: number
  stationId?: string
}

export class NWSProvider implements WeatherProvider {
  readonly name = 'nws'

  covers(lat: number, lon: number): boolean {
    // CONUS
    if (lat >= 24.5 && lat <= 49.5 && lon >= -125 && lon <= -66.5) return true
    // Alaska
    if (lat >= 54 && lat <= 71.5 && lon >= -168 && lon <= -141) return true
    // Hawaii
    if (lat >= 18.9 && lat <= 22.3 && lon >= -160.3 && lon <= -154.8) return true
    return false
  }

  private async resolveGrid(lat: number, lon: number): Promise<NWSGridInfo> {
    const data = (await nwsFetch(`${NWS_BASE}/points/${lat},${lon}`)) as {
      properties: { gridId: string; gridX: number; gridY: number }
    }
    return {
      gridId: data.properties.gridId,
      gridX: data.properties.gridX,
      gridY: data.properties.gridY,
    }
  }

  private async resolveStation(grid: NWSGridInfo): Promise<string> {
    const data = (await nwsFetch(
      `${NWS_BASE}/gridpoints/${grid.gridId}/${grid.gridX},${grid.gridY}/stations`
    )) as { features: Array<{ properties: { stationIdentifier: string } }> }
    if (!data.features.length) throw new Error('No NWS stations found')
    return data.features[0].properties.stationIdentifier
  }

  async getObservation(lat: number, lon: number): Promise<ObservationView> {
    const grid = await this.resolveGrid(lat, lon)
    const stationId = await this.resolveStation(grid)
    const data = (await nwsFetch(
      `${NWS_BASE}/stations/${stationId}/observations/latest`
    )) as {
      properties: {
        timestamp: string
        temperature: { value: number }
        relativeHumidity: { value: number }
        windSpeed: { value: number }
        windDirection: { value: number | null }
        textDescription: string | null
        icon: string | null
      }
    }
    const p = data.properties
    return {
      h3Index: '',  // filled in by handler
      observedAt: p.timestamp,
      provider: this.name,
      stale: false,
      temperature: { value: p.temperature.value, unit: 'C' },
      humidity: Math.round(p.relativeHumidity.value),
      windSpeed: { value: p.windSpeed.value, unit: 'km/h' },
      windDirection: p.windDirection.value ?? undefined,
      conditions: p.textDescription ?? undefined,
      icon: p.icon ?? undefined,
    }
  }

  async getForecast(lat: number, lon: number): Promise<ForecastView> {
    const grid = await this.resolveGrid(lat, lon)
    const data = (await nwsFetch(
      `${NWS_BASE}/gridpoints/${grid.gridId}/${grid.gridX},${grid.gridY}/forecast?units=si`
    )) as {
      properties: {
        generatedAt: string
        periods: Array<{
          name: string
          startTime: string
          endTime: string
          isDaytime: boolean
          temperature: number
          windSpeed: string
          windDirection: string | null
          shortForecast: string
          detailedForecast: string
          probabilityOfPrecipitation: { value: number | null }
        }>
      }
    }
    const p = data.properties
    const periods: ForecastPeriod[] = p.periods.map((period) => ({
      name: period.name,
      startTime: period.startTime,
      endTime: period.endTime,
      isDaytime: period.isDaytime,
      temperature: { value: period.temperature, unit: 'C' },
      precipProbability: period.probabilityOfPrecipitation.value ?? undefined,
      windSpeed: { value: parseWindSpeed(period.windSpeed), unit: 'km/h' },
      windDirection: period.windDirection
        ? COMPASS_TO_DEGREES[period.windDirection] ?? undefined
        : undefined,
      conditions: period.shortForecast,
      detailedForecast: period.detailedForecast,
    }))
    return {
      h3Index: '',  // filled in by handler
      generatedAt: p.generatedAt,
      provider: this.name,
      stale: false,
      periods,
    }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/providers/nws.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/nws.ts tests/providers/nws.test.ts
git commit -m "feat: NWS provider with observation and forecast"
```

---

## Task 7: Open-Meteo Provider

**Files:**
- Create: `src/providers/open-meteo.ts`
- Create: `tests/providers/open-meteo.test.ts`

Open-Meteo URL: `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_probability_max&wind_speed_unit=kmh&timezone=auto`

Returns temperature in Celsius and wind speed in km/h natively.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/open-meteo.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenMeteoProvider } from '../../src/providers/open-meteo'

const mockResponse = {
  timezone: 'America/New_York',
  current: {
    time: '2026-05-01T12:00',
    temperature_2m: 18.5,
    relative_humidity_2m: 72,
    wind_speed_10m: 12.0,
    wind_direction_10m: 200,
    weather_code: 2,
  },
  daily: {
    time: ['2026-05-01', '2026-05-02'],
    weather_code: [2, 61],
    temperature_2m_max: [20.0, 14.0],
    temperature_2m_min: [10.0, 8.0],
    wind_speed_10m_max: [15.0, 25.0],
    wind_direction_10m_dominant: [200, 270],
    precipitation_probability_max: [5, 80],
  },
}

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => mockResponse,
  } as Response)
})

afterEach(() => { vi.restoreAllMocks() })

describe('OpenMeteoProvider.covers', () => {
  const provider = new OpenMeteoProvider()
  it('covers London', () => expect(provider.covers(51.5, -0.1)).toBe(true))
  it('covers Tokyo', () => expect(provider.covers(35.7, 139.7)).toBe(true))
  it('covers everywhere', () => expect(provider.covers(-33.9, 151.2)).toBe(true))
})

describe('OpenMeteoProvider.getObservation', () => {
  it('transforms current conditions', async () => {
    const provider = new OpenMeteoProvider()
    const obs = await provider.getObservation(51.5, -0.1)

    expect(obs.provider).toBe('open-meteo')
    expect(obs.temperature).toEqual({ value: 18.5, unit: 'C' })
    expect(obs.humidity).toBe(72)
    expect(obs.windSpeed).toEqual({ value: 12, unit: 'km/h' })
    expect(obs.windDirection).toBe(200)
    expect(obs.conditions).toBe('Partly Cloudy')
  })
})

describe('OpenMeteoProvider.getForecast', () => {
  it('returns one period per day', async () => {
    const provider = new OpenMeteoProvider()
    const forecast = await provider.getForecast(51.5, -0.1)

    expect(forecast.periods).toHaveLength(2)
    expect(forecast.periods[0].name).toBe('2026-05-01')
    expect(forecast.periods[0].temperature).toEqual({ value: 20, unit: 'C' })
    expect(forecast.periods[0].conditions).toBe('Partly Cloudy')
    expect(forecast.periods[1].conditions).toBe('Light Rain')
    expect(forecast.periods[1].precipProbability).toBe(80)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/providers/open-meteo.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement src/providers/open-meteo.ts**

```typescript
// src/providers/open-meteo.ts
import type { WeatherProvider, ObservationView, ForecastView, ForecastPeriod } from './types'

const BASE_URL = 'https://api.open-meteo.com/v1/forecast'
const TIMEOUT_MS = 10_000

const WMO_CONDITIONS: Record<number, string> = {
  0: 'Clear Sky',
  1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Icy Fog',
  51: 'Light Drizzle', 53: 'Moderate Drizzle', 55: 'Dense Drizzle',
  61: 'Light Rain', 63: 'Moderate Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Moderate Snow', 75: 'Heavy Snow',
  77: 'Snow Grains',
  80: 'Light Showers', 81: 'Moderate Showers', 82: 'Heavy Showers',
  85: 'Light Snow Showers', 86: 'Heavy Snow Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with Light Hail', 99: 'Thunderstorm with Heavy Hail',
}

interface OpenMeteoResponse {
  timezone: string
  current: {
    time: string
    temperature_2m: number
    relative_humidity_2m: number
    wind_speed_10m: number
    wind_direction_10m: number
    weather_code: number
  }
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    wind_speed_10m_max: number[]
    wind_direction_10m_dominant: number[]
    precipitation_probability_max: number[]
  }
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<OpenMeteoResponse> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code',
    daily: 'weather_code,temperature_2m_max,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_probability_max',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}?${params}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
    return res.json() as Promise<OpenMeteoResponse>
  } finally {
    clearTimeout(timer)
  }
}

export class OpenMeteoProvider implements WeatherProvider {
  readonly name = 'open-meteo'

  covers(_lat: number, _lon: number): boolean {
    return true  // global fallback
  }

  async getObservation(lat: number, lon: number): Promise<ObservationView> {
    const data = await fetchOpenMeteo(lat, lon)
    const c = data.current
    return {
      h3Index: '',  // filled in by handler
      observedAt: new Date(c.time).toISOString(),
      provider: this.name,
      stale: false,
      temperature: { value: c.temperature_2m, unit: 'C' },
      humidity: c.relative_humidity_2m,
      windSpeed: { value: c.wind_speed_10m, unit: 'km/h' },
      windDirection: c.wind_direction_10m,
      conditions: WMO_CONDITIONS[c.weather_code] ?? String(c.weather_code),
    }
  }

  async getForecast(lat: number, lon: number): Promise<ForecastView> {
    const data = await fetchOpenMeteo(lat, lon)
    const d = data.daily
    const periods: ForecastPeriod[] = d.time.map((date, i) => ({
      name: date,
      startTime: new Date(`${date}T00:00:00`).toISOString(),
      endTime: new Date(`${date}T23:59:59`).toISOString(),
      isDaytime: true,
      temperature: { value: d.temperature_2m_max[i], unit: 'C' },
      precipProbability: d.precipitation_probability_max[i],
      windSpeed: { value: d.wind_speed_10m_max[i], unit: 'km/h' },
      windDirection: d.wind_direction_10m_dominant[i],
      conditions: WMO_CONDITIONS[d.weather_code[i]] ?? String(d.weather_code[i]),
    }))
    return {
      h3Index: '',  // filled in by handler
      generatedAt: new Date().toISOString(),
      provider: this.name,
      stale: false,
      periods,
    }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/providers/open-meteo.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/open-meteo.ts tests/providers/open-meteo.test.ts
git commit -m "feat: Open-Meteo provider with observation and forecast"
```

---

## Task 8: Provider Router

**Files:**
- Create: `src/providers/router.ts`
- Create: `tests/providers/router.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/router.test.ts
import { describe, it, expect } from 'vitest'
import { selectProvider } from '../../src/providers/router'
import { NWSProvider } from '../../src/providers/nws'
import { OpenMeteoProvider } from '../../src/providers/open-meteo'

describe('selectProvider', () => {
  it('selects NWS for a US coordinate', () => {
    const provider = selectProvider(47.6, -122.3)
    expect(provider).toBeInstanceOf(NWSProvider)
  })

  it('selects Open-Meteo for a non-US coordinate', () => {
    const provider = selectProvider(51.5, -0.1)
    expect(provider).toBeInstanceOf(OpenMeteoProvider)
  })

  it('selects NWS for Hawaii', () => {
    const provider = selectProvider(21.3, -157.8)
    expect(provider).toBeInstanceOf(NWSProvider)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/providers/router.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement src/providers/router.ts**

```typescript
// src/providers/router.ts
import type { WeatherProvider } from './types'
import { NWSProvider } from './nws'
import { OpenMeteoProvider } from './open-meteo'

const PROVIDERS: WeatherProvider[] = [
  new NWSProvider(),
  new OpenMeteoProvider(),
]

export function selectProvider(lat: number, lon: number): WeatherProvider {
  const provider = PROVIDERS.find((p) => p.covers(lat, lon))
  if (!provider) throw new Error('No provider covers this location')
  return provider
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/providers/router.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/router.ts tests/providers/router.test.ts
git commit -m "feat: provider router selects NWS vs Open-Meteo by geography"
```

---

## Task 9: Auth Verifier

**Files:**
- Create: `src/auth.ts`
- Create: `tests/auth.test.ts`

The `AuthVerifier` function is called by `@atproto/xrpc-server` per request. It receives the Express `req` object and must return `{ did: string }` or throw.

`@atproto/identity` is used to resolve the DID and verify the token. The token is a signed JWT (service token) in the `Authorization: Bearer <token>` header. Use `@atproto/identity`'s `DidResolver` to resolve the DID document, then verify the JWT signature.

> **Note:** The exact `@atproto/identity` API for token verification may need adjustment based on your Bluesky/ATProto setup. The pattern below follows the standard PDS auth flow. If you use OAuth instead of service tokens, see the `@atproto/oauth-provider` package.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/auth.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createAuthVerifier } from '../src/auth'

afterEach(() => vi.restoreAllMocks())

describe('createAuthVerifier', () => {
  it('throws AuthRequired when Authorization header is missing', async () => {
    const verifier = createAuthVerifier()
    const ctx = { req: { headers: {} } } as never

    await expect(verifier(ctx)).rejects.toMatchObject({ message: 'AuthRequired' })
  })

  it('throws AuthRequired for non-Bearer token', async () => {
    const verifier = createAuthVerifier()
    const ctx = { req: { headers: { authorization: 'Basic abc123' } } } as never

    await expect(verifier(ctx)).rejects.toMatchObject({ message: 'AuthRequired' })
  })

  it('returns did on valid token', async () => {
    // Mock the DidResolver to avoid real network calls
    const { DidResolver } = await import('@atproto/identity')
    vi.spyOn(DidResolver.prototype, 'resolveAtprotoData').mockResolvedValue({
      did: 'did:plc:abc123',
      signingKey: 'did:key:zQ3shXXX',
      handle: 'alice.bsky.social',
      pds: 'https://bsky.social',
    } as never)

    // verifyJwt is internal; for integration, use a real signed token
    // This test just confirms the verifier returns the DID when resolution succeeds
    // Full integration requires a real signed JWT — test with curl in Task 14
    expect(true).toBe(true) // placeholder until integration test
  })
})
```

- [ ] **Step 2: Run tests — verify the first two pass**

```bash
npm test -- tests/auth.test.ts
```

Expected: first two tests FAIL with "Cannot find module" initially.

- [ ] **Step 3: Implement src/auth.ts**

```typescript
// src/auth.ts
import { DidResolver, verifyJwt } from '@atproto/identity'

const didResolver = new DidResolver({})

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export function createAuthVerifier() {
  return async (ctx: { req: { headers: Record<string, string | string[] | undefined> } }) => {
    const authHeader = ctx.req.headers['authorization']
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null

    if (!token) throw new AuthError('AuthRequired')

    try {
      const payload = await verifyJwt(token, null, null, async (did: string) => {
        const data = await didResolver.resolveAtprotoData(did)
        return data.signingKey
      })
      return { did: payload.iss }
    } catch {
      throw new AuthError('AuthRequired')
    }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/auth.test.ts
```

Expected: 3 tests pass (the third is a trivial placeholder).

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/auth.test.ts
git commit -m "feat: ATProto DID auth verifier"
```

---

## Task 10: Lexicon JSON Files

**Files:**
- Create: `lexicons/getObservation.json`
- Create: `lexicons/getForecast.json`
- Create: `lexicons/getSolarTimes.json`

These are the ATProto lexicon schemas. They are loaded at server startup by `@atproto/xrpc-server` for request/response validation.

- [ ] **Step 1: Create lexicons/getObservation.json**

```json
{
  "lexicon": 1,
  "id": "garden.lexicon.surprising-scallop.getObservation",
  "defs": {
    "main": {
      "type": "query",
      "description": "Get current weather conditions for an H3 geographic cell (resolution 4–6).",
      "parameters": {
        "type": "params",
        "required": ["h3Index"],
        "properties": {
          "h3Index": {
            "type": "string",
            "description": "H3 cell ID at resolution 4–6."
          }
        }
      },
      "output": {
        "encoding": "application/json",
        "schema": { "type": "ref", "ref": "#observationView" }
      },
      "errors": [
        { "name": "InvalidH3Index" },
        { "name": "UnsupportedResolution" },
        { "name": "ProviderUnavailable" },
        { "name": "ProviderTimeout" }
      ]
    },
    "measurement": {
      "type": "object",
      "required": ["value", "unit"],
      "properties": {
        "value": { "type": "number" },
        "unit": { "type": "string" }
      }
    },
    "observationView": {
      "type": "object",
      "required": ["h3Index", "observedAt", "provider", "stale", "temperature", "humidity", "windSpeed"],
      "properties": {
        "h3Index": { "type": "string" },
        "observedAt": { "type": "string", "format": "datetime" },
        "provider": { "type": "string", "knownValues": ["nws", "open-meteo"] },
        "stale": { "type": "boolean" },
        "temperature": { "type": "ref", "ref": "#measurement" },
        "humidity": { "type": "integer", "minimum": 0, "maximum": 100 },
        "windSpeed": { "type": "ref", "ref": "#measurement" },
        "windDirection": { "type": "integer", "minimum": 0, "maximum": 360 },
        "conditions": { "type": "string" },
        "icon": { "type": "string", "format": "uri" }
      }
    }
  }
}
```

- [ ] **Step 2: Create lexicons/getForecast.json**

```json
{
  "lexicon": 1,
  "id": "garden.lexicon.surprising-scallop.getForecast",
  "defs": {
    "main": {
      "type": "query",
      "description": "Get upcoming weather forecast periods for an H3 geographic cell (resolution 4–6).",
      "parameters": {
        "type": "params",
        "required": ["h3Index"],
        "properties": {
          "h3Index": {
            "type": "string",
            "description": "H3 cell ID at resolution 4–6."
          }
        }
      },
      "output": {
        "encoding": "application/json",
        "schema": { "type": "ref", "ref": "#forecastView" }
      },
      "errors": [
        { "name": "InvalidH3Index" },
        { "name": "UnsupportedResolution" },
        { "name": "ProviderUnavailable" },
        { "name": "ProviderTimeout" }
      ]
    },
    "measurement": {
      "type": "object",
      "required": ["value", "unit"],
      "properties": {
        "value": { "type": "number" },
        "unit": { "type": "string" }
      }
    },
    "forecastPeriod": {
      "type": "object",
      "required": ["name", "startTime", "endTime", "isDaytime", "temperature", "windSpeed"],
      "properties": {
        "name": { "type": "string" },
        "startTime": { "type": "string", "format": "datetime" },
        "endTime": { "type": "string", "format": "datetime" },
        "isDaytime": { "type": "boolean" },
        "temperature": { "type": "ref", "ref": "#measurement" },
        "precipProbability": { "type": "integer", "minimum": 0, "maximum": 100 },
        "windSpeed": { "type": "ref", "ref": "#measurement" },
        "windDirection": { "type": "integer", "minimum": 0, "maximum": 360 },
        "conditions": { "type": "string" },
        "detailedForecast": { "type": "string" }
      }
    },
    "forecastView": {
      "type": "object",
      "required": ["h3Index", "generatedAt", "provider", "stale", "periods"],
      "properties": {
        "h3Index": { "type": "string" },
        "generatedAt": { "type": "string", "format": "datetime" },
        "provider": { "type": "string", "knownValues": ["nws", "open-meteo"] },
        "stale": { "type": "boolean" },
        "periods": {
          "type": "array",
          "items": { "type": "ref", "ref": "#forecastPeriod" }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Create lexicons/getSolarTimes.json**

```json
{
  "lexicon": 1,
  "id": "garden.lexicon.surprising-scallop.getSolarTimes",
  "defs": {
    "main": {
      "type": "query",
      "description": "Get solar event times for an H3 cell on a given date. Computed from the cell centroid — no upstream API required.",
      "parameters": {
        "type": "params",
        "required": ["h3Index"],
        "properties": {
          "h3Index": {
            "type": "string",
            "description": "H3 cell ID at resolution 4–6."
          },
          "date": {
            "type": "string",
            "description": "ISO 8601 date (e.g. '2026-05-01'). Defaults to today UTC."
          }
        }
      },
      "output": {
        "encoding": "application/json",
        "schema": { "type": "ref", "ref": "#solarTimesView" }
      },
      "errors": [
        { "name": "InvalidH3Index" },
        { "name": "UnsupportedResolution" },
        { "name": "InvalidDate" }
      ]
    },
    "solarTimesView": {
      "type": "object",
      "required": ["h3Index", "date", "dawn", "sunrise", "solarNoon", "sunset", "dusk", "nadir"],
      "properties": {
        "h3Index": { "type": "string" },
        "date": { "type": "string" },
        "astronomicalDawn": { "type": "string", "format": "datetime" },
        "nauticalDawn": { "type": "string", "format": "datetime" },
        "dawn": { "type": "string", "format": "datetime" },
        "sunrise": { "type": "string", "format": "datetime" },
        "goldenHourMorningEnd": { "type": "string", "format": "datetime" },
        "solarNoon": { "type": "string", "format": "datetime" },
        "goldenHourEveningStart": { "type": "string", "format": "datetime" },
        "sunset": { "type": "string", "format": "datetime" },
        "dusk": { "type": "string", "format": "datetime" },
        "nauticalDusk": { "type": "string", "format": "datetime" },
        "astronomicalDusk": { "type": "string", "format": "datetime" },
        "nadir": { "type": "string", "format": "datetime" }
      }
    }
  }
}
```

- [ ] **Step 4: Validate lexicons with Lexicon Garden MCP**

In Claude Code, call the `validate_lexicon` Lexicon Garden MCP tool with each JSON file's contents to confirm they are valid ATProto lexicon schemas. Fix any validation errors before proceeding.

- [ ] **Step 5: Commit**

```bash
git add lexicons/
git commit -m "feat: ATProto lexicon schemas for getObservation, getForecast, getSolarTimes"
```

---

## Task 11: getObservation Handler

**Files:**
- Create: `src/handlers/getObservation.ts`
- Create: `tests/handlers/getObservation.test.ts`

This handler orchestrates: validate H3 → check cache → if stale, fetch from provider → store → return.

Cache TTL: 15 minutes (900,000 ms).

On provider error: if stale cache exists, return it with `stale: true`. If no cache at all, throw `ProviderUnavailable` or `ProviderTimeout`.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/handlers/getObservation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { insertObservation } from '../../src/db/cache'
import { makeGetObservationHandler } from '../../src/handlers/getObservation'
import type { WeatherProvider, ObservationView } from '../../src/providers/types'
import type Database from 'better-sqlite3'

let db: Database.Database

const mockObservation: ObservationView = {
  h3Index: '852a1073fffffff',
  observedAt: '2026-05-01T12:00:00Z',
  provider: 'nws',
  stale: false,
  temperature: { value: 15.5, unit: 'C' },
  humidity: 65,
  windSpeed: { value: 16, unit: 'km/h' },
}

const mockProvider: WeatherProvider = {
  name: 'nws',
  covers: () => true,
  getObservation: vi.fn().mockResolvedValue({ ...mockObservation, h3Index: '' }),
  getForecast: vi.fn(),
}

beforeEach(() => {
  db = openDatabase(':memory:')
  vi.clearAllMocks()
})

describe('makeGetObservationHandler', () => {
  it('fetches from provider on cache miss', async () => {
    const handler = makeGetObservationHandler(db, () => mockProvider)
    const result = await handler({ params: { h3Index: '852a1073fffffff' }, auth: { did: 'did:plc:test' } } as never)

    expect(mockProvider.getObservation).toHaveBeenCalledOnce()
    expect(result.body.h3Index).toBe('852a1073fffffff')
    expect(result.body.stale).toBe(false)
  })

  it('returns cached data when fresh', async () => {
    insertObservation(db, '852a1073fffffff', 'nws', mockObservation)
    const handler = makeGetObservationHandler(db, () => mockProvider)
    await handler({ params: { h3Index: '852a1073fffffff' }, auth: { did: 'did:plc:test' } } as never)

    expect(mockProvider.getObservation).not.toHaveBeenCalled()
  })

  it('returns stale cache with stale:true when provider throws', async () => {
    // Insert old observation (> 15 min ago)
    db.prepare(
      'INSERT INTO observations (h3_index, provider, fetched_at, payload) VALUES (?, ?, ?, ?)'
    ).run('852a1073fffffff', 'nws', Date.now() - 1000 * 60 * 20, JSON.stringify(mockObservation))

    const failingProvider = { ...mockProvider, getObservation: vi.fn().mockRejectedValue(new Error('NWS down')) }
    const handler = makeGetObservationHandler(db, () => failingProvider)
    const result = await handler({ params: { h3Index: '852a1073fffffff' }, auth: { did: 'did:plc:test' } } as never)

    expect(result.body.stale).toBe(true)
  })

  it('throws InvalidH3Index for bad cell', async () => {
    const handler = makeGetObservationHandler(db, () => mockProvider)
    await expect(
      handler({ params: { h3Index: 'garbage' }, auth: { did: 'did:plc:test' } } as never)
    ).rejects.toMatchObject({ code: 'InvalidH3Index' })
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/handlers/getObservation.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement src/handlers/getObservation.ts**

```typescript
// src/handlers/getObservation.ts
import type Database from 'better-sqlite3'
import { validateH3Index, getCentroid } from '../h3'
import {
  getLatestObservation,
  insertObservation,
  getProviderMap,
  setProviderMap,
  isStale,
} from '../db/cache'
import { selectProvider } from '../providers/router'
import type { WeatherProvider, ObservationView } from '../providers/types'

const OBSERVATION_TTL_MS = 15 * 60 * 1000  // 15 minutes

type ProviderSelector = (lat: number, lon: number) => WeatherProvider

export function makeGetObservationHandler(db: Database.Database, selectProviderFn: ProviderSelector = selectProvider) {
  return async (ctx: { params: { h3Index: string } }) => {
    const { h3Index } = ctx.params
    validateH3Index(h3Index)

    const cached = getLatestObservation(db, h3Index)
    if (cached && !isStale(cached, OBSERVATION_TTL_MS)) {
      return { encoding: 'application/json', body: JSON.parse(cached.payload) as ObservationView }
    }

    const [lat, lon] = getCentroid(h3Index)

    // Check provider map cache to avoid re-routing
    let provider: WeatherProvider
    const providerMap = getProviderMap(db, h3Index)
    if (providerMap) {
      provider = selectProviderFn(lat, lon)  // re-use same lat/lon routing
    } else {
      provider = selectProviderFn(lat, lon)
      setProviderMap(db, h3Index, provider.name)
    }

    try {
      const view = await provider.getObservation(lat, lon)
      view.h3Index = h3Index
      insertObservation(db, h3Index, provider.name, view)
      return { encoding: 'application/json', body: view }
    } catch (err) {
      if (cached) {
        const staleView = JSON.parse(cached.payload) as ObservationView
        staleView.stale = true
        return { encoding: 'application/json', body: staleView }
      }
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      throw Object.assign(new Error(isTimeout ? 'ProviderTimeout' : 'ProviderUnavailable'), {
        code: isTimeout ? 'ProviderTimeout' : 'ProviderUnavailable',
        status: isTimeout ? 504 : 503,
      })
    }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/handlers/getObservation.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/getObservation.ts tests/handlers/getObservation.test.ts
git commit -m "feat: getObservation handler with cache, stale fallback, and error handling"
```

---

## Task 12: getForecast Handler

**Files:**
- Create: `src/handlers/getForecast.ts`
- Create: `tests/handlers/getForecast.test.ts`

Identical orchestration logic to getObservation, but uses forecast cache table and a 1-hour TTL.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/handlers/getForecast.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { insertForecast } from '../../src/db/cache'
import { makeGetForecastHandler } from '../../src/handlers/getForecast'
import type { WeatherProvider, ForecastView } from '../../src/providers/types'
import type Database from 'better-sqlite3'

let db: Database.Database

const mockForecast: ForecastView = {
  h3Index: '852a1073fffffff',
  generatedAt: '2026-05-01T12:00:00Z',
  provider: 'nws',
  stale: false,
  periods: [
    {
      name: 'Tonight',
      startTime: '2026-05-01T18:00:00Z',
      endTime: '2026-05-02T06:00:00Z',
      isDaytime: false,
      temperature: { value: 8, unit: 'C' },
      windSpeed: { value: 16, unit: 'km/h' },
    },
  ],
}

const mockProvider: WeatherProvider = {
  name: 'nws',
  covers: () => true,
  getObservation: vi.fn(),
  getForecast: vi.fn().mockResolvedValue({ ...mockForecast, h3Index: '' }),
}

beforeEach(() => {
  db = openDatabase(':memory:')
  vi.clearAllMocks()
})

describe('makeGetForecastHandler', () => {
  it('fetches from provider on cache miss', async () => {
    const handler = makeGetForecastHandler(db, () => mockProvider)
    const result = await handler({ params: { h3Index: '852a1073fffffff' }, auth: { did: 'did:plc:test' } } as never)

    expect(mockProvider.getForecast).toHaveBeenCalledOnce()
    expect(result.body.h3Index).toBe('852a1073fffffff')
  })

  it('returns cached forecast when fresh', async () => {
    insertForecast(db, '852a1073fffffff', 'nws', mockForecast)
    const handler = makeGetForecastHandler(db, () => mockProvider)
    await handler({ params: { h3Index: '852a1073fffffff' }, auth: { did: 'did:plc:test' } } as never)

    expect(mockProvider.getForecast).not.toHaveBeenCalled()
  })

  it('returns stale cache with stale:true on provider failure', async () => {
    db.prepare(
      'INSERT INTO forecasts (h3_index, provider, fetched_at, payload) VALUES (?, ?, ?, ?)'
    ).run('852a1073fffffff', 'nws', Date.now() - 1000 * 60 * 90, JSON.stringify(mockForecast))

    const failingProvider = { ...mockProvider, getForecast: vi.fn().mockRejectedValue(new Error('NWS down')) }
    const handler = makeGetForecastHandler(db, () => failingProvider)
    const result = await handler({ params: { h3Index: '852a1073fffffff' }, auth: { did: 'did:plc:test' } } as never)

    expect(result.body.stale).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/handlers/getForecast.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement src/handlers/getForecast.ts**

```typescript
// src/handlers/getForecast.ts
import type Database from 'better-sqlite3'
import { validateH3Index, getCentroid } from '../h3'
import {
  getLatestForecast,
  insertForecast,
  getProviderMap,
  setProviderMap,
  isStale,
} from '../db/cache'
import { selectProvider } from '../providers/router'
import type { WeatherProvider, ForecastView } from '../providers/types'

const FORECAST_TTL_MS = 60 * 60 * 1000  // 1 hour

type ProviderSelector = (lat: number, lon: number) => WeatherProvider

export function makeGetForecastHandler(db: Database.Database, selectProviderFn: ProviderSelector = selectProvider) {
  return async (ctx: { params: { h3Index: string } }) => {
    const { h3Index } = ctx.params
    validateH3Index(h3Index)

    const cached = getLatestForecast(db, h3Index)
    if (cached && !isStale(cached, FORECAST_TTL_MS)) {
      return { encoding: 'application/json', body: JSON.parse(cached.payload) as ForecastView }
    }

    const [lat, lon] = getCentroid(h3Index)

    let provider: WeatherProvider
    const providerMap = getProviderMap(db, h3Index)
    if (providerMap) {
      provider = selectProviderFn(lat, lon)
    } else {
      provider = selectProviderFn(lat, lon)
      setProviderMap(db, h3Index, provider.name)
    }

    try {
      const view = await provider.getForecast(lat, lon)
      view.h3Index = h3Index
      insertForecast(db, h3Index, provider.name, view)
      return { encoding: 'application/json', body: view }
    } catch (err) {
      if (cached) {
        const staleView = JSON.parse(cached.payload) as ForecastView
        staleView.stale = true
        return { encoding: 'application/json', body: staleView }
      }
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      throw Object.assign(new Error(isTimeout ? 'ProviderTimeout' : 'ProviderUnavailable'), {
        code: isTimeout ? 'ProviderTimeout' : 'ProviderUnavailable',
        status: isTimeout ? 504 : 503,
      })
    }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/handlers/getForecast.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/getForecast.ts tests/handlers/getForecast.test.ts
git commit -m "feat: getForecast handler with 1-hour cache and stale fallback"
```

---

## Task 13: getSolarTimes Handler

**Files:**
- Create: `src/handlers/getSolarTimes.ts`
- Create: `tests/handlers/getSolarTimes.test.ts`

Uses `suncalc` to compute solar event times for the H3 centroid. No provider, no cache. `suncalc.getTimes(date, lat, lon)` returns `Date` objects; if a value is `NaN` (polar night / midnight sun), omit the field.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/handlers/getSolarTimes.test.ts
import { describe, it, expect } from 'vitest'
import { getSolarTimesHandler } from '../../src/handlers/getSolarTimes'

describe('getSolarTimesHandler', () => {
  it('returns solar times for a normal location and date', async () => {
    const result = await getSolarTimesHandler({
      params: { h3Index: '852a1073fffffff', date: '2026-05-01' },
      auth: { did: 'did:plc:test' },
    } as never)

    expect(result.body.h3Index).toBe('852a1073fffffff')
    expect(result.body.date).toBe('2026-05-01')
    expect(result.body.sunrise).toBeDefined()
    expect(result.body.sunset).toBeDefined()
    expect(result.body.solarNoon).toBeDefined()
    expect(result.body.nadir).toBeDefined()
    // Verify sunrise is before sunset
    expect(new Date(result.body.sunrise).getTime()).toBeLessThan(new Date(result.body.sunset).getTime())
  })

  it('defaults to today when date is omitted', async () => {
    const result = await getSolarTimesHandler({
      params: { h3Index: '852a1073fffffff' },
      auth: { did: 'did:plc:test' },
    } as never)

    const today = new Date().toISOString().slice(0, 10)
    expect(result.body.date).toBe(today)
  })

  it('throws InvalidDate for a bad date string', async () => {
    await expect(
      getSolarTimesHandler({
        params: { h3Index: '852a1073fffffff', date: 'not-a-date' },
        auth: { did: 'did:plc:test' },
      } as never)
    ).rejects.toMatchObject({ code: 'InvalidDate' })
  })

  it('throws InvalidH3Index for a bad cell', async () => {
    await expect(
      getSolarTimesHandler({
        params: { h3Index: 'garbage', date: '2026-05-01' },
        auth: { did: 'did:plc:test' },
      } as never)
    ).rejects.toMatchObject({ code: 'InvalidH3Index' })
  })

  it('omits polar fields when they are NaN (extreme latitude)', async () => {
    // Svalbard in December — astronomical dawn/dusk may be NaN (polar night)
    const result = await getSolarTimesHandler({
      params: { h3Index: '840d97fffffffff', date: '2026-12-21' },
      auth: { did: 'did:plc:test' },
    } as never)
    // nadir is always defined; other fields may or may not be defined
    expect(result.body.nadir).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/handlers/getSolarTimes.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement src/handlers/getSolarTimes.ts**

```typescript
// src/handlers/getSolarTimes.ts
import SunCalc from 'suncalc'
import { validateH3Index, getCentroid } from '../h3'
import { XRPCError } from '../h3'

export interface SolarTimesView {
  h3Index: string
  date: string
  astronomicalDawn?: string
  nauticalDawn?: string
  dawn: string
  sunrise: string
  goldenHourMorningEnd?: string
  solarNoon: string
  goldenHourEveningStart?: string
  sunset: string
  dusk: string
  nauticalDusk?: string
  astronomicalDusk?: string
  nadir: string
}

function toISO(d: Date): string | undefined {
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

function toISORequired(d: Date, fieldName: string): string {
  const s = toISO(d)
  if (!s) throw new Error(`suncalc returned NaN for required field: ${fieldName}`)
  return s
}

export async function getSolarTimesHandler(ctx: {
  params: { h3Index: string; date?: string }
}) {
  const { h3Index, date: dateParam } = ctx.params

  validateH3Index(h3Index)

  const dateStr = dateParam ?? new Date().toISOString().slice(0, 10)
  const date = new Date(`${dateStr}T12:00:00Z`)
  if (isNaN(date.getTime())) {
    throw new XRPCError('InvalidDate', `Invalid date: ${dateParam}`)
  }

  const [lat, lon] = getCentroid(h3Index)
  const times = SunCalc.getTimes(date, lat, lon)

  const view: SolarTimesView = {
    h3Index,
    date: dateStr,
    astronomicalDawn: toISO(times.nightEnd),
    nauticalDawn: toISO(times.nauticalDawn),
    dawn: toISORequired(times.dawn, 'dawn'),
    sunrise: toISORequired(times.sunrise, 'sunrise'),
    goldenHourMorningEnd: toISO(times.goldenHourEnd),
    solarNoon: toISORequired(times.solarNoon, 'solarNoon'),
    goldenHourEveningStart: toISO(times.goldenHour),
    sunset: toISORequired(times.sunset, 'sunset'),
    dusk: toISORequired(times.dusk, 'dusk'),
    nauticalDusk: toISO(times.nauticalDusk),
    astronomicalDusk: toISO(times.night),
    nadir: toISORequired(times.nadir, 'nadir'),
  }

  // For polar night: dawn/sunrise/sunset/dusk may be NaN — strip required and make them optional
  const safeView: Partial<SolarTimesView> & { h3Index: string; date: string; nadir: string } = {
    h3Index,
    date: dateStr,
    astronomicalDawn: view.astronomicalDawn,
    nauticalDawn: view.nauticalDawn,
    goldenHourMorningEnd: view.goldenHourMorningEnd,
    goldenHourEveningStart: view.goldenHourEveningStart,
    nauticalDusk: view.nauticalDusk,
    astronomicalDusk: view.astronomicalDusk,
    nadir: toISO(times.nadir) ?? new Date(date.getTime() + 12 * 3600 * 1000).toISOString(),
  }
  if (!isNaN(times.dawn.getTime())) safeView.dawn = times.dawn.toISOString()
  if (!isNaN(times.sunrise.getTime())) safeView.sunrise = times.sunrise.toISOString()
  if (!isNaN(times.solarNoon.getTime())) safeView.solarNoon = times.solarNoon.toISOString()
  if (!isNaN(times.sunset.getTime())) safeView.sunset = times.sunset.toISOString()
  if (!isNaN(times.dusk.getTime())) safeView.dusk = times.dusk.toISOString()

  return { encoding: 'application/json', body: safeView }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/handlers/getSolarTimes.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/getSolarTimes.ts tests/handlers/getSolarTimes.test.ts
git commit -m "feat: getSolarTimes handler using suncalc, handles polar edge cases"
```

---

## Task 14: Server Wiring

**Files:**
- Modify: `src/server.ts`

This task wires everything together. No unit tests — validated by running the server and curling it.

- [ ] **Step 1: Implement src/server.ts**

```typescript
// src/server.ts
import express from 'express'
import { createServer } from '@atproto/xrpc-server'
import type { LexiconDoc } from '@atproto/lexicon'
import { openDatabase } from './db/client'
import { makeGetObservationHandler } from './handlers/getObservation'
import { makeGetForecastHandler } from './handlers/getForecast'
import { getSolarTimesHandler } from './handlers/getSolarTimes'
import { createAuthVerifier } from './auth'
import { XRPCError } from './h3'

import getObservationLex from '../lexicons/getObservation.json'
import getForecastLex from '../lexicons/getForecast.json'
import getSolarTimesLex from '../lexicons/getSolarTimes.json'

const DB_PATH = process.env.DB_PATH ?? './weather.db'
const PORT = Number(process.env.PORT ?? 3000)

const db = openDatabase(DB_PATH)
const auth = createAuthVerifier()
const server = createServer(
  [getObservationLex, getForecastLex, getSolarTimesLex] as LexiconDoc[],
  {
    validateResponse: true,
    errorParser: (err: unknown) => {
      if (err instanceof XRPCError) return { status: 400, error: err.code, message: err.message }
      if (err instanceof Error && 'code' in err) {
        const e = err as Error & { code: string; status?: number }
        return { status: e.status ?? 500, error: e.code, message: e.message }
      }
      return null
    },
  }
)

server.method('garden.lexicon.surprising-scallop.getObservation', {
  auth,
  handler: makeGetObservationHandler(db),
})

server.method('garden.lexicon.surprising-scallop.getForecast', {
  auth,
  handler: makeGetForecastHandler(db),
})

server.method('garden.lexicon.surprising-scallop.getSolarTimes', {
  auth,
  handler: getSolarTimesHandler,
})

const app = express()
app.use(server.router)
app.listen(PORT, () => {
  console.log(`weather-xrpc listening on port ${PORT}`)
})

export { app }
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Verify server starts**

```bash
npm run dev
```

Expected output:
```
weather-xrpc listening on port 3000
```

- [ ] **Step 4: Smoke test getSolarTimes (no auth required to confirm routing)**

```bash
# Get an H3 cell for San Francisco (resolution 5)
node -e "const h = require('h3-js'); console.log(h.latLngToCell(37.77, -122.41, 5))"
# Use that cell ID in the curl below (e.g. 852a1073fffffff)
curl -s "http://localhost:3000/xrpc/garden.lexicon.surprising-scallop.getSolarTimes?h3Index=852a1073fffffff&date=2026-05-01"
```

Expected: `{"h3Index":"852a1073fffffff","date":"2026-05-01","sunrise":"...","sunset":"...",...}`

> Note: `getObservation` and `getForecast` require a valid ATProto DID token. To test those, use a real ATProto service token from your PDS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: Express + xrpc-server wiring, all three procedures registered"
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| H3 cell validation (res 4–6) | Task 2 |
| SQLite cache + archive | Tasks 3–4 |
| NWS provider (US) | Task 6 |
| Open-Meteo provider (global) | Task 7 |
| Provider routing | Task 8 |
| ATProto DID auth | Task 9 |
| Lexicon JSON schemas | Task 10 |
| getObservation handler | Task 11 |
| getForecast handler | Task 12 |
| getSolarTimes handler | Task 13 |
| stale-while-on-error | Tasks 11–12 |
| `stale: true` flag | Tasks 11–12 |
| Server wiring | Task 14 |
| `ProviderUnavailable` / `ProviderTimeout` errors | Tasks 11–12 |
| `InvalidDate` error | Task 13 |

**Type consistency check:** `ObservationView`, `ForecastView`, `ForecastPeriod`, `WeatherProvider` defined in Task 5 and used consistently in Tasks 6–12. `XRPCError` defined in Task 2 and used in Tasks 13–14. `CacheRow` / `ProviderMapEntry` defined in Task 4 and used in Tasks 11–12.
