import { describe, it, expect } from 'vitest'
import { getSolarTimesHandler } from '../../src/handlers/getSolarTimes'

const SF_RES_5 = '85283083fffffff'
const SVALBARD_RES_4 = '840153bffffffff'

describe('getSolarTimesHandler', () => {
  it('returns solar times for a normal location and date', async () => {
    const result = await getSolarTimesHandler({
      params: { h3Index: SF_RES_5, date: '2026-05-01' },
      auth: { did: 'did:plc:test' },
    } as never)

    expect(result.body.h3Index).toBe(SF_RES_5)
    expect(result.body.date).toBe('2026-05-01')
    expect(result.body.sunrise).toBeDefined()
    expect(result.body.sunset).toBeDefined()
    expect(result.body.solarNoon).toBeDefined()
    expect(result.body.nadir).toBeDefined()
    expect(new Date(result.body.sunrise!).getTime()).toBeLessThan(new Date(result.body.sunset!).getTime())
  })

  it('defaults to today when date is omitted', async () => {
    const result = await getSolarTimesHandler({
      params: { h3Index: SF_RES_5 },
      auth: { did: 'did:plc:test' },
    } as never)

    const today = new Date().toISOString().slice(0, 10)
    expect(result.body.date).toBe(today)
  })

  it('throws InvalidDate for a bad date string', async () => {
    await expect(
      getSolarTimesHandler({
        params: { h3Index: SF_RES_5, date: 'not-a-date' },
        auth: { did: 'did:plc:test' },
      } as never)
    ).rejects.toMatchObject({ code: 'InvalidDate' })
  })

  it('throws InvalidH3Index for a bad cell', async () => {
    await expect(
      getSolarTimesHandler({
        params: { h3Index: 'garbage', date: '2026-05-01' },
        auth: { did: 'did:plc:test' },
      } as never)
    ).rejects.toMatchObject({ code: 'InvalidH3Index' })
  })

  it('omits polar fields when they are NaN (extreme latitude)', async () => {
    const result = await getSolarTimesHandler({
      params: { h3Index: SVALBARD_RES_4, date: '2026-12-21' },
      auth: { did: 'did:plc:test' },
    } as never)
    expect(result.body.nadir).toBeDefined()
  })
})
