import SunCalc from 'suncalc'
import { validateH3Index, getCentroid, XRPCError } from '../h3'

export interface SolarTimesView {
  h3Index: string
  date: string
  astronomicalDawn?: string
  nauticalDawn?: string
  dawn?: string
  sunrise?: string
  goldenHourMorningEnd?: string
  solarNoon?: string
  goldenHourEveningStart?: string
  sunset?: string
  dusk?: string
  nauticalDusk?: string
  astronomicalDusk?: string
  nadir: string
}

function toISO(d: Date): string | undefined {
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function getSolarTimesHandler(ctx: {
  params: { h3Index: string; date?: string }
}) {
  const { h3Index, date: dateParam } = ctx.params

  validateH3Index(h3Index)

  const dateStr = dateParam ?? new Date().toISOString().slice(0, 10)
  if (!ISO_DATE_RE.test(dateStr)) {
    throw new XRPCError('InvalidDate', `Invalid date: ${dateParam}`)
  }
  const date = new Date(`${dateStr}T12:00:00Z`)
  if (isNaN(date.getTime())) {
    throw new XRPCError('InvalidDate', `Invalid date: ${dateParam}`)
  }

  const [lat, lon] = getCentroid(h3Index)
  const times = SunCalc.getTimes(date, lat, lon)

  const nadir = toISO(times.nadir)
  if (!nadir) {
    throw new XRPCError('InvalidDate', 'Unable to compute solar nadir for this location/date')
  }

  const view: SolarTimesView = {
    h3Index,
    date: dateStr,
    astronomicalDawn: toISO(times.nightEnd),
    nauticalDawn: toISO(times.nauticalDawn),
    dawn: toISO(times.dawn),
    sunrise: toISO(times.sunrise),
    goldenHourMorningEnd: toISO(times.goldenHourEnd),
    solarNoon: toISO(times.solarNoon),
    goldenHourEveningStart: toISO(times.goldenHour),
    sunset: toISO(times.sunset),
    dusk: toISO(times.dusk),
    nauticalDusk: toISO(times.nauticalDusk),
    astronomicalDusk: toISO(times.night),
    nadir,
  }

  return { encoding: 'application/json', body: view }
}
