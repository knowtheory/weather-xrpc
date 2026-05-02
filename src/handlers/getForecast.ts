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
import type { WeatherProvider, ForecastView, ForecastPeriod } from '../providers/types'

const FORECAST_TTL_MS = 60 * 60 * 1000

type ProviderSelector = (lat: number, lon: number) => WeatherProvider

function roundPeriod(p: ForecastPeriod): ForecastPeriod {
  return {
    ...p,
    temperature: { ...p.temperature, value: Math.round(p.temperature.value) },
    windSpeed: { ...p.windSpeed, value: Math.round(p.windSpeed.value) },
    windDirection: p.windDirection !== undefined ? Math.round(p.windDirection) : undefined,
    precipProbability: p.precipProbability !== undefined ? Math.round(p.precipProbability) : undefined,
  }
}

function roundForecast(view: ForecastView): ForecastView {
  return { ...view, periods: view.periods.map(roundPeriod) }
}

export function makeGetForecastHandler(
  db: Database.Database,
  selectProviderFn: ProviderSelector = selectProvider
) {
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
      const raw = await provider.getForecast(lat, lon)
      raw.h3Index = h3Index
      const view = roundForecast(raw)
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
