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

const SF_RES_5 = '85283083fffffff'

let db: Database.Database

beforeEach(() => {
  db = openDatabase(':memory:')
})

const mockObservation: ObservationView = {
  h3Index: SF_RES_5,
  observedAt: '2026-05-01T12:00:00Z',
  provider: 'nws',
  stale: false,
  temperature: { value: 15.5, unit: 'C' },
  humidity: 65,
  windSpeed: { value: 16, unit: 'km/h' },
}

const mockForecast: ForecastView = {
  h3Index: SF_RES_5,
  generatedAt: '2026-05-01T12:00:00Z',
  provider: 'nws',
  stale: false,
  periods: [],
}

describe('observations', () => {
  it('returns undefined when no observation exists', () => {
    expect(getLatestObservation(db, SF_RES_5)).toBeUndefined()
  })

  it('stores and retrieves an observation', () => {
    insertObservation(db, SF_RES_5, 'nws', mockObservation)
    const row = getLatestObservation(db, SF_RES_5)
    expect(row).toBeDefined()
    expect(JSON.parse(row!.payload)).toMatchObject({ provider: 'nws' })
  })

  it('returns the most recent observation when multiple exist', () => {
    insertObservation(db, SF_RES_5, 'nws', { ...mockObservation, observedAt: '2026-05-01T11:00:00Z' })
    insertObservation(db, SF_RES_5, 'nws', { ...mockObservation, observedAt: '2026-05-01T12:00:00Z' })
    const row = getLatestObservation(db, SF_RES_5)
    expect(JSON.parse(row!.payload).observedAt).toBe('2026-05-01T12:00:00Z')
  })
})

describe('forecasts', () => {
  it('returns undefined when no forecast exists', () => {
    expect(getLatestForecast(db, SF_RES_5)).toBeUndefined()
  })

  it('stores and retrieves a forecast', () => {
    insertForecast(db, SF_RES_5, 'open-meteo', mockForecast)
    const row = getLatestForecast(db, SF_RES_5)
    expect(row).toBeDefined()
    expect(row!.provider).toBe('open-meteo')
  })
})

describe('h3_provider_map', () => {
  it('returns undefined for unknown cell', () => {
    expect(getProviderMap(db, SF_RES_5)).toBeUndefined()
  })

  it('stores and retrieves provider assignment', () => {
    setProviderMap(db, SF_RES_5, 'nws', { gridId: 'SEW', gridX: 124, gridY: 67, stationId: 'KSEA' })
    const entry = getProviderMap(db, SF_RES_5)
    expect(entry?.provider).toBe('nws')
    expect(entry?.metadata?.gridId).toBe('SEW')
  })
})

describe('isStale', () => {
  it('returns false for a fresh row', () => {
    const row = { fetchedAt: Date.now() - 1000 * 60 * 5 }
    expect(isStale(row, 1000 * 60 * 15)).toBe(false)
  })

  it('returns true for an expired row', () => {
    const row = { fetchedAt: Date.now() - 1000 * 60 * 20 }
    expect(isStale(row, 1000 * 60 * 15)).toBe(true)
  })
})
