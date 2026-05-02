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
       FROM observations WHERE h3_index = ? ORDER BY fetched_at DESC, id DESC LIMIT 1`
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
       FROM forecasts WHERE h3_index = ? ORDER BY fetched_at DESC, id DESC LIMIT 1`
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
