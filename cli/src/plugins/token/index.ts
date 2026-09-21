import type { Login } from '@/plugins/session'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { definePlugin } from '@/kernel/plugin'
import { env } from '@/plugins/env'
import { session } from '@/plugins/session'
import { detectTokenStore, getTokenStore } from '@/store/manager'
import { bareHost } from '@/util/host'

export type TokenService = {
  readonly get: () => Promise<string>
  readonly write: (login: Login, bearer: string) => Promise<void>
  readonly remove: (login: Login) => Promise<void>
  readonly detect: () => Promise<'keychain' | 'file'>
}

export const token = definePlugin({
  name: 'token',
  needs: [env, session],
  build: async (ctx): Promise<TokenService> => {
    const { token: envToken } = await ctx.get(env)
    const sessionService = await ctx.get(session)

    let cached: string | undefined

    async function readFromStore(): Promise<string> {
      const login = await sessionService.require()
      const store = getTokenStore(login.tokenStorage)
      return store.read(bareHost(login.server), login.email)
    }

    return {
      get: async () => {
        if (envToken !== undefined) return envToken
        if (cached === undefined) cached = await readFromStore()
        if (cached === '') {
          throw new BaseError({
            code: ErrorCode.NotLoggedIn,
            message: 'not logged in',
            hint: 'run difyctl login',
          })
        }
        return cached
      },
      write: async (login: Login, bearer: string) => {
        const store = getTokenStore(login.tokenStorage)
        await store.write(bareHost(login.server), login.email, bearer)
        cached = bearer
      },
      remove: async (login: Login) => {
        const store = getTokenStore(login.tokenStorage)
        await store.remove(bareHost(login.server), login.email)
        cached = ''
      },
      detect: async () => (await detectTokenStore()).mode,
    }
  },
})
