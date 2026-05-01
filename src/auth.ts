import { DidResolver } from '@atproto/identity'
import { verifyJwt } from '@atproto/xrpc-server'

const didResolver = new DidResolver({})

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

type AuthCtx = { req: { headers: Record<string, string | string[] | undefined> } }

export function createAuthVerifier() {
  return async (ctx: AuthCtx): Promise<{ did: string }> => {
    const authHeader = ctx.req.headers['authorization']
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null

    if (!token) throw new AuthError('AuthRequired')

    try {
      const payload = await verifyJwt(token, null, null, async (did: string) => {
        return await didResolver.resolveAtprotoKey(did)
      })
      return { did: payload.iss }
    } catch {
      throw new AuthError('AuthRequired')
    }
  }
}
