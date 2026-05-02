import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
