import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { insertObservation } from '../../src/db/cache'
import { makeGetObservationHandler } from '../../src/handlers/getObservation'
import type { WeatherProvider, ObservationView } from '../../src/providers/types'
import type Database from 'better-sqlite3'

const SF_RES_5 = '85283083fffffff'

let db: Database.Database

const mockObservation: ObservationView = {
  h3Index: SF_RES_5,
  observedAt: '2026-05-01T12:00:00Z',
  provider: 'nws',
  stale: false,
  temperature: { value: 16, unit: 'C' },
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
    const result = await handler({ params: { h3Index: SF_RES_5 }, auth: { did: 'did:plc:test' } } as never)

    expect(mockProvider.getObservation).toHaveBeenCalledOnce()
    expect(result.body.h3Index).toBe(SF_RES_5)
    expect(result.body.stale).toBe(false)
  })

  it('returns cached data when fresh', async () => {
    insertObservation(db, SF_RES_5, 'nws', mockObservation)
    const handler = makeGetObservationHandler(db, () => mockProvider)
    await handler({ params: { h3Index: SF_RES_5 }, auth: { did: 'did:plc:test' } } as never)

    expect(mockProvider.getObservation).not.toHaveBeenCalled()
  })

  it('returns stale cache with stale:true when provider throws', async () => {
    db.prepare(
      'INSERT INTO observations (h3_index, provider, fetched_at, payload) VALUES (?, ?, ?, ?)'
    ).run(SF_RES_5, 'nws', Date.now() - 1000 * 60 * 20, JSON.stringify(mockObservation))

    const failingProvider = { ...mockProvider, getObservation: vi.fn().mockRejectedValue(new Error('NWS down')) }
    const handler = makeGetObservationHandler(db, () => failingProvider)
    const result = await handler({ params: { h3Index: SF_RES_5 }, auth: { did: 'did:plc:test' } } as never)

    expect(result.body.stale).toBe(true)
  })

  it('throws InvalidH3Index for bad cell', async () => {
    const handler = makeGetObservationHandler(db, () => mockProvider)
    await expect(
      handler({ params: { h3Index: 'garbage' }, auth: { did: 'did:plc:test' } } as never)
    ).rejects.toMatchObject({ code: 'InvalidH3Index' })
  })

  it('rounds fractional measurement values to integers', async () => {
    const fractionalProvider = {
      ...mockProvider,
      getObservation: vi.fn().mockResolvedValue({
        ...mockObservation,
        h3Index: '',
        temperature: { value: 15.5, unit: 'C' },
        windSpeed: { value: 16.7, unit: 'km/h' },
      }),
    }
    const handler = makeGetObservationHandler(db, () => fractionalProvider)
    const result = await handler({ params: { h3Index: SF_RES_5 }, auth: { did: 'did:plc:test' } } as never)
    expect(result.body.temperature.value).toBe(16)
    expect(result.body.windSpeed.value).toBe(17)
  })
})
