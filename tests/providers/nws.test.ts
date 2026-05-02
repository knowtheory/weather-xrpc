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
