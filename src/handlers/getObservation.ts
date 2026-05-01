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

const OBSERVATION_TTL_MS = 15 * 60 * 1000

type ProviderSelector = (lat: number, lon: number) => WeatherProvider

function roundObservation(view: ObservationView): ObservationView {
  return {
    ...view,
    temperature: { ...view.temperature, value: Math.round(view.temperature.value) },
    humidity: Math.round(view.humidity),
    windSpeed: { ...view.windSpeed, value: Math.round(view.windSpeed.value) },
    windDirection: view.windDirection !== undefined ? Math.round(view.windDirection) : undefined,
  }
}

export function makeGetObservationHandler(
  db: Database.Database,
  selectProviderFn: ProviderSelector = selectProvider
) {
  return async (ctx: { params: { h3Index: string } }) => {
    const { h3Index } = ctx.params
    validateH3Index(h3Index)

    const cached = getLatestObservation(db, h3Index)
    if (cached && !isStale(cached, OBSERVATION_TTL_MS)) {
      return { encoding: 'application/json', body: JSON.parse(cached.payload) as ObservationView }
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
      const raw = await provider.getObservation(lat, lon)
      raw.h3Index = h3Index
      const view = roundObservation(raw)
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
