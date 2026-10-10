import type { StorageMode } from '@/store/store'
import { join } from 'node:path'
import { z } from 'zod'
import { BaseError, notLoggedIn } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { definePlugin } from '@/kernel/plugin'
import { env } from '@/plugins/env'
import { STORAGE_MODES, YamlStore } from '@/store/store'

export const LOGIN_FILE_NAME = 'login.yml'
export const LOGIN_SCHEMA_VERSION = 1
export const ENV_LOGIN_EMAIL = 'env'

const ACCOUNT_SCHEMA = z.object({ id: z.string(), email: z.string(), name: z.string() })

const LOGIN_SCHEMA = z
  .object({
    schema_version: z.literal(LOGIN_SCHEMA_VERSION),
    server: z.string(),
    email: z.string(),
    account: ACCOUNT_SCHEMA.nullable(),
    workspace_id: z.string().nullable(),
    token_storage: z.enum(STORAGE_MODES),
    insecure: z.boolean(),
  })
  .strict()

export type Login = Readonly<{
  server: string
  email: string
  account: Readonly<{ id: string; email: string; name: string }> | null
  workspaceId: string | null
  tokenStorage: StorageMode
  insecure: boolean
}>

export type SessionService = {
  readonly current: () => Promise<Login | null>
  readonly require: () => Promise<Login>
  readonly save: (login: Login) => Promise<void>
  readonly clear: () => Promise<void>
  readonly workspaceId: () => Promise<string | null>
  readonly fromEnv: boolean
}

function loginToDoc(login: Login): z.infer<typeof LOGIN_SCHEMA> {
  return {
    schema_version: LOGIN_SCHEMA_VERSION,
    server: login.server,
    email: login.email,
    account: login.account,
    workspace_id: login.workspaceId,
    token_storage: login.tokenStorage,
    insecure: login.insecure,
  }
}

function docToLogin(doc: z.infer<typeof LOGIN_SCHEMA>): Login {
  return {
    server: doc.server,
    email: doc.email,
    account: doc.account,
    workspaceId: doc.workspace_id,
    tokenStorage: doc.token_storage,
    insecure: doc.insecure,
  }
}

export const session = definePlugin({
  name: 'session',
  needs: [env],
  build: async (ctx): Promise<SessionService> => {
    const { server, token: envToken, workspaceId: envWorkspaceId, configDir } = await ctx.get(env)
    // An env login is the pair: a server on its own only says where to log in.
    const fromEnv = server !== undefined && envToken !== undefined
    const path = join(configDir, LOGIN_FILE_NAME)
    const store = new YamlStore(path)

    const envLogin: Login | null = fromEnv
      ? {
          server,
          email: ENV_LOGIN_EMAIL,
          account: null,
          workspaceId: envWorkspaceId ?? null,
          tokenStorage: 'file',
          insecure: false,
        }
      : null

    async function readLogin(): Promise<Login | null> {
      const raw = await store.getTyped<unknown>()
      if (raw === null) return null
      const result = LOGIN_SCHEMA.safeParse(raw)
      if (!result.success) {
        throw new BaseError({
          code: ErrorCode.Unknown,
          message: `${path} failed validation: ${result.error.issues.map((issue) => issue.message).join('; ')}`,
        })
      }
      return docToLogin(result.data)
    }

    const current = async (): Promise<Login | null> => envLogin ?? readLogin()

    return {
      current,
      require: async () => {
        const login = await current()
        if (login === null) throw notLoggedIn()
        return login
      },
      save: async (login: Login) => {
        if (fromEnv) {
          throw new BaseError({
            code: ErrorCode.UsageInvalidFlag,
            message: 'cannot save a login while DIFY_SERVER/DIFY_TOKEN are set',
          })
        }
        await store.setTyped(loginToDoc(login))
      },
      clear: async () => {
        if (fromEnv) return
        await store.rm()
      },
      workspaceId: async () => {
        if (envWorkspaceId !== undefined) return envWorkspaceId
        const login = await current()
        return login?.workspaceId ?? null
      },
      fromEnv,
    }
  },
})
