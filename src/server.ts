import express from 'express'
import {
  createServer,
  XRPCError as XRPCResponseError,
  InvalidRequestError,
  UpstreamFailureError,
  UpstreamTimeoutError,
} from '@atproto/xrpc-server'
import type { LexiconDoc } from '@atproto/lexicon'
import { openDatabase } from './db/client'
import { makeGetObservationHandler } from './handlers/getObservation'
import { makeGetForecastHandler } from './handlers/getForecast'
import { getSolarTimesHandler } from './handlers/getSolarTimes'
import { createAuthVerifier } from './auth'
import { XRPCError } from './h3'

import getObservationLex from '../lexicons/getObservation.json'
import getForecastLex from '../lexicons/getForecast.json'
import getSolarTimesLex from '../lexicons/getSolarTimes.json'

const DB_PATH = process.env.DB_PATH ?? './weather.db'
const PORT = Number(process.env.PORT ?? 3000)

const db = openDatabase(DB_PATH)
const auth = createAuthVerifier()
const server = createServer(
  [getObservationLex, getForecastLex, getSolarTimesLex] as LexiconDoc[],
  {
    validateResponse: true,
    errorParser: (err: unknown) => {
      if (err instanceof XRPCError) {
        return new InvalidRequestError(err.message, err.code)
      }
      if (err instanceof Error && 'code' in err) {
        const e = err as Error & { code: string }
        if (e.code === 'ProviderTimeout') return new UpstreamTimeoutError(e.message, e.code)
        if (e.code === 'ProviderUnavailable') return new UpstreamFailureError(e.message, e.code)
      }
      return XRPCResponseError.fromError(err)
    },
  }
)

const observationHandler = makeGetObservationHandler(db)
const forecastHandler = makeGetForecastHandler(db)

server.method('garden.lexicon.surprising-scallop.getObservation', {
  auth,
  handler: (ctx) => observationHandler({ params: ctx.params as { h3Index: string } }),
})

server.method('garden.lexicon.surprising-scallop.getForecast', {
  auth,
  handler: (ctx) => forecastHandler({ params: ctx.params as { h3Index: string } }),
})

server.method('garden.lexicon.surprising-scallop.getSolarTimes', {
  auth,
  handler: (ctx) => getSolarTimesHandler({ params: ctx.params as { h3Index: string; date?: string } }),
})

const app = express()
app.use(server.router)
app.listen(PORT, () => {
  console.log(`weather-xrpc listening on port ${PORT}`)
})

export { app }
