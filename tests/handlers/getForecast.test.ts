import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { insertForecast } from '../../src/db/cache'
import { makeGetForecastHandler } from '../../src/handlers/getForecast'
import type { WeatherProvider, ForecastView } from '../../src/providers/types'
import type Database from 'better-sqlite3'

const SF_RES_5 = '85283083fffffff'

let db: Database.Database

const mockForecast: ForecastView = {
  h3Index: SF_RES_5,
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
    const result = await handler({ params: { h3Index: SF_RES_5 }, auth: { did: 'did:plc:test' } } as never)

    expect(mockProvider.getForecast).toHaveBeenCalledOnce()
    expect(result.body.h3Index).toBe(SF_RES_5)
  })

  it('returns cached forecast when fresh', async () => {
    insertForecast(db, SF_RES_5, 'nws', mockForecast)
    const handler = makeGetForecastHandler(db, () => mockProvider)
    await handler({ params: { h3Index: SF_RES_5 }, auth: { did: 'did:plc:test' } } as never)

    expect(mockProvider.getForecast).not.toHaveBeenCalled()
  })

  it('returns stale cache with stale:true on provider failure', async () => {
    db.prepare(
      'INSERT INTO forecasts (h3_index, provider, fetched_at, payload) VALUES (?, ?, ?, ?)'
    ).run(SF_RES_5, 'nws', Date.now() - 1000 * 60 * 90, JSON.stringify(mockForecast))

    const failingProvider = { ...mockProvider, getForecast: vi.fn().mockRejectedValue(new Error('NWS down')) }
    const handler = makeGetForecastHandler(db, () => failingProvider)
    const result = await handler({ params: { h3Index: SF_RES_5 }, auth: { did: 'did:plc:test' } } as never)

    expect(result.body.stale).toBe(true)
  })

  it('rounds fractional measurement values to integers', async () => {
    const fractionalProvider = {
      ...mockProvider,
      getForecast: vi.fn().mockResolvedValue({
        ...mockForecast,
        h3Index: '',
        periods: [
          {
            ...mockForecast.periods[0],
            temperature: { value: 8.4, unit: 'C' },
            windSpeed: { value: 15.7, unit: 'km/h' },
          },
        ],
      }),
    }
    const handler = makeGetForecastHandler(db, () => fractionalProvider)
    const result = await handler({ params: { h3Index: SF_RES_5 }, auth: { did: 'did:plc:test' } } as never)
    expect(result.body.periods[0].temperature.value).toBe(8)
    expect(result.body.periods[0].windSpeed.value).toBe(16)
  })
})
