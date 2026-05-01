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
    return true
  }

  async getObservation(lat: number, lon: number): Promise<ObservationView> {
    const data = await fetchOpenMeteo(lat, lon)
    const c = data.current
    return {
      h3Index: '',
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
      h3Index: '',
      generatedAt: new Date().toISOString(),
      provider: this.name,
      stale: false,
      periods,
    }
  }
}
