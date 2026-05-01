import { describe, it, expect } from 'vitest'
import { selectProvider } from '../../src/providers/router'
import { NWSProvider } from '../../src/providers/nws'
import { OpenMeteoProvider } from '../../src/providers/open-meteo'

describe('selectProvider', () => {
  it('selects NWS for a US coordinate', () => {
    const provider = selectProvider(47.6, -122.3)
    expect(provider).toBeInstanceOf(NWSProvider)
  })

  it('selects Open-Meteo for a non-US coordinate', () => {
    const provider = selectProvider(51.5, -0.1)
    expect(provider).toBeInstanceOf(OpenMeteoProvider)
  })

  it('selects NWS for Hawaii', () => {
    const provider = selectProvider(21.3, -157.8)
    expect(provider).toBeInstanceOf(NWSProvider)
  })
})
