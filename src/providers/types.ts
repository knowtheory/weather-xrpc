export interface Temperature {
  value: number
  unit: 'C'
}

export interface WindSpeed {
  value: number
  unit: 'km/h'
}

export interface ObservationView {
  h3Index: string
  observedAt: string
  provider: string
  stale: boolean
  temperature: Temperature
  humidity: number
  windSpeed: WindSpeed
  windDirection?: number
  conditions?: string
  icon?: string
}

export interface ForecastPeriod {
  name: string
  startTime: string
  endTime: string
  isDaytime: boolean
  temperature: Temperature
  precipProbability?: number
  windSpeed: WindSpeed
  windDirection?: number
  conditions?: string
  detailedForecast?: string
}

export interface ForecastView {
  h3Index: string
  generatedAt: string
  provider: string
  stale: boolean
  periods: ForecastPeriod[]
}

export interface WeatherProvider {
  name: string
  covers(lat: number, lon: number): boolean
  getObservation(lat: number, lon: number): Promise<ObservationView>
  getForecast(lat: number, lon: number): Promise<ForecastView>
}
