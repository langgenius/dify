import type { Login } from '@/plugins/session'
import type { StorageMode } from '@/store/store'
import type { TokenStore } from '@/store/token-store'
import { join } from 'node:path'
import { notLoggedIn } from '@/errors/base'
import { definePlugin } from '@/kernel/plugin'
import { env } from '@/plugins/env'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { localFile } from '@/store/local-file'
import { detectTokenStore, getTokenStore } from '@/store/manager'
import { TOKENS_SCHEMA } from '@/store/token-store'
import { bareHost } from '@/util/host'

export const TOKENS_FILE_NAME = 'tokens.yml'

export type DetectOptions = Readonly<{ skipKeyring: boolean }>

export type TokenService = {
  readonly get: () => Promise<string>
  readonly write: (login: Login, bearer: string) => Promise<void>
  readonly remove: (login: Login) => Promise<void>
  readonly detect: (opts: DetectOptions) => Promise<StorageMode>
  readonly store: (mode: StorageMode) => TokenStore
}

export const token = definePlugin({
  name: 'token',
  needs: [env, session, io],
  build: async (ctx): Promise<TokenService> => {
    const { token: envToken, configDir } = await ctx.get(env)
    const sessionService = await ctx.get(session)
    const file = localFile(
      join(configDir, TOKENS_FILE_NAME),
      TOKENS_SCHEMA,
      (await ctx.get(io)).notice,
    )

    let cached: string | undefined

    const store = (mode: StorageMode): TokenStore => getTokenStore(mode, { file })

    async function readFromStore(): Promise<string> {
      const login = await sessionService.require()
      return store(login.tokenStorage).read(bareHost(login.server), login.email)
    }

    return {
      get: async () => {
        if (envToken !== undefined) return envToken
        if (cached === undefined) cached = await readFromStore()
        if (cached === '') throw notLoggedIn()
        return cached
      },
      write: async (login: Login, bearer: string) => {
        await store(login.tokenStorage).write(bareHost(login.server), login.email, bearer)
        cached = bearer
      },
      remove: async (login: Login) => {
        await store(login.tokenStorage).remove(bareHost(login.server), login.email)
        cached = ''
      },
      detect: async (opts) => (await detectTokenStore({ ...opts, file })).mode,
      store,
    }
  },
})
