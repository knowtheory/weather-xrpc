import { DidResolver } from '@atproto/identity'
import { verifyJwt, AuthRequiredError } from '@atproto/xrpc-server'

const didResolver = new DidResolver({})

type AuthCtx = { req: { headers: Record<string, string | string[] | undefined> } }

export function createAuthVerifier() {
  return async (ctx: AuthCtx): Promise<{ credentials: { did: string } }> => {
    const authHeader = ctx.req.headers['authorization']
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null

    if (!token) throw new AuthRequiredError('AuthRequired')

    try {
      const payload = await verifyJwt(token, null, null, async (did: string) => {
        return await didResolver.resolveAtprotoKey(did)
      })
      return { credentials: { did: payload.iss } }
    } catch {
      throw new AuthRequiredError('AuthRequired')
    }
  }
}
