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
    if (lat >= 24.5 && lat <= 49.5 && lon >= -125 && lon <= -66.5) return true
    if (lat >= 54 && lat <= 71.5 && lon >= -168 && lon <= -141) return true
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
      h3Index: '',
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
      h3Index: '',
      generatedAt: p.generatedAt,
      provider: this.name,
      stale: false,
      periods,
    }
  }
}
