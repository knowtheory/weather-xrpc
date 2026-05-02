import { isValidCell, cellToLatLng, getResolution as h3GetResolution } from 'h3-js'

const MIN_RESOLUTION = 4
const MAX_RESOLUTION = 6

export class XRPCError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'XRPCError'
  }
}

export function validateH3Index(h3Index: string): void {
  if (!isValidCell(h3Index)) {
    throw new XRPCError('InvalidH3Index', `Invalid H3 cell: ${h3Index}`)
  }
  const res = h3GetResolution(h3Index)
  if (res < MIN_RESOLUTION || res > MAX_RESOLUTION) {
    throw new XRPCError(
      'UnsupportedResolution',
      `H3 resolution ${res} not supported — use resolution ${MIN_RESOLUTION}–${MAX_RESOLUTION}`
    )
  }
}

export function getCentroid(h3Index: string): [number, number] {
  return cellToLatLng(h3Index) as [number, number]
}

export function getResolution(h3Index: string): number {
  return h3GetResolution(h3Index)
}
