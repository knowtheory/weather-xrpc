import type { WeatherProvider } from './types'
import { NWSProvider } from './nws'
import { OpenMeteoProvider } from './open-meteo'

const PROVIDERS: WeatherProvider[] = [
  new NWSProvider(),
  new OpenMeteoProvider(),
]

export function selectProvider(lat: number, lon: number): WeatherProvider {
  const provider = PROVIDERS.find((p) => p.covers(lat, lon))
  if (!provider) throw new Error('No provider covers this location')
  return provider
}
