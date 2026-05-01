import { describe, it, expect } from 'vitest'
import { validateH3Index, getCentroid, getResolution } from '../src/h3'

// SF-area H3 cells, computed from latLngToCell(37.77, -122.41, res).
const SF_RES_4 = '8428309ffffffff'
const SF_RES_5 = '85283083fffffff'
const SF_RES_6 = '86283082fffffff'
const SF_RES_3 = '832830fffffffff'
const SF_RES_7 = '872830828ffffff'

describe('validateH3Index', () => {
  it('accepts valid resolution-5 cell', () => {
    expect(() => validateH3Index(SF_RES_5)).not.toThrow()
  })

  it('accepts valid resolution-4 cell', () => {
    expect(() => validateH3Index(SF_RES_4)).not.toThrow()
  })

  it('accepts valid resolution-6 cell', () => {
    expect(() => validateH3Index(SF_RES_6)).not.toThrow()
  })

  it('throws InvalidH3Index for garbage string', () => {
    expect(() => validateH3Index('not-an-h3-cell')).toThrow('InvalidH3Index')
  })

  it('throws UnsupportedResolution for resolution 3', () => {
    expect(() => validateH3Index(SF_RES_3)).toThrow('UnsupportedResolution')
  })

  it('throws UnsupportedResolution for resolution 7', () => {
    expect(() => validateH3Index(SF_RES_7)).toThrow('UnsupportedResolution')
  })
})

describe('getCentroid', () => {
  it('returns [lat, lon] for a valid cell', () => {
    const [lat, lon] = getCentroid(SF_RES_5)
    expect(lat).toBeCloseTo(37.79, 1)
    expect(lon).toBeCloseTo(-122.35, 1)
  })
})

describe('getResolution', () => {
  it('returns 5 for a res-5 cell', () => {
    expect(getResolution(SF_RES_5)).toBe(5)
  })
})
