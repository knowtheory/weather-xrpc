/**
 * Mints an ATProto service-auth JWT for testing the weather XRPC server.
 *
 * Reads from env:
 *   BSKY_HANDLE         e.g. alice.bsky.social
 *   BSKY_APP_PASSWORD   App password (NOT main password) — generate at
 *                       https://bsky.app/settings/app-passwords
 *   BSKY_SERVICE        Optional, default https://bsky.social
 *   AUD                 Optional audience DID, default did:web:weather-xrpc.local
 *                       (server doesn't validate audience, so any DID works)
 *
 * Prints the JWT to stdout.
 *
 *   curl -H "Authorization: Bearer $(npx tsx scripts/get-service-token.ts)" \
 *     "http://localhost:3001/xrpc/garden.lexicon.surprising-scallop.getSolarTimes?h3Index=85283083fffffff&date=2026-05-01"
 */
import { AtpAgent } from '@atproto/api'

const handle = process.env.BSKY_HANDLE
const password = process.env.BSKY_APP_PASSWORD
const service = process.env.BSKY_SERVICE ?? 'https://bsky.social'
const aud = process.env.AUD ?? 'did:web:weather-xrpc.local'

if (!handle || !password) {
  console.error('Missing BSKY_HANDLE or BSKY_APP_PASSWORD env vars.')
  console.error('Generate an app password at https://bsky.app/settings/app-passwords.')
  process.exit(1)
}

async function main() {
  const agent = new AtpAgent({ service })
  await agent.login({ identifier: handle!, password: password! })

  const res = await agent.com.atproto.server.getServiceAuth({ aud })
  process.stdout.write(res.data.token)
}

main().catch((err) => {
  console.error('Failed to mint service token:', err.message ?? err)
  process.exit(1)
})
