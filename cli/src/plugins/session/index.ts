import type { StorageMode } from '@/store/store'
import { join } from 'node:path'
import { z } from 'zod'
import { BaseError, notLoggedIn } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { definePlugin } from '@/kernel/plugin'
import { ENV, env } from '@/plugins/env'
import { io } from '@/plugins/io'
import { localFile, REMOVE } from '@/store/local-file'
import { STORAGE_MODES } from '@/store/store'

export const LOGIN_FILE_NAME = 'login.yml'
export const ENV_LOGIN_EMAIL = 'env'

const LOGIN_SCHEMA = z.object({
  server: z.string(),
  email: z.string(),
  token_storage: z.enum(STORAGE_MODES),
  account: z
    .object({ id: z.string(), email: z.string(), name: z.string() })
    .nullable()
    .default(null),
  workspace_id: z.string().nullable().default(null),
  insecure: z.boolean().default(false),
  session_id: z.string().nullable().default(null),
})

type LoginDoc = z.infer<typeof LOGIN_SCHEMA>

export type Login = Readonly<{
  server: string
  email: string
  account: Readonly<{ id: string; email: string; name: string }> | null
  workspaceId: string | null
  tokenStorage: StorageMode
  insecure: boolean
  sessionId: string | null
}>

export type SessionService = {
  readonly current: () => Promise<Login | null>
  readonly require: () => Promise<Login>
  readonly save: (login: Login) => Promise<void>
  readonly clear: () => Promise<void>
  readonly workspaceId: () => Promise<string | null>
  readonly fromEnv: boolean
}

function loginToDoc(login: Login): LoginDoc {
  return {
    server: login.server,
    email: login.email,
    account: login.account,
    workspace_id: login.workspaceId,
    token_storage: login.tokenStorage,
    insecure: login.insecure,
    session_id: login.sessionId,
  }
}

function docToLogin(doc: LoginDoc): Login {
  return {
    server: doc.server,
    email: doc.email,
    account: doc.account,
    workspaceId: doc.workspace_id,
    tokenStorage: doc.token_storage,
    insecure: doc.insecure,
    sessionId: doc.session_id,
  }
}

export const session = definePlugin({
  name: 'session',
  needs: [env, io],
  build: async (ctx): Promise<SessionService> => {
    const { server, token: envToken, workspaceId: envWorkspaceId, configDir } = await ctx.get(env)
    // An env login is the pair: a server on its own only says where to log in.
    const fromEnv = server !== undefined && envToken !== undefined
    const file = localFile(
      join(configDir, LOGIN_FILE_NAME),
      LOGIN_SCHEMA,
      (await ctx.get(io)).notice,
    )

    const envLogin: Login | null = fromEnv
      ? {
          server,
          email: ENV_LOGIN_EMAIL,
          account: null,
          workspaceId: envWorkspaceId ?? null,
          tokenStorage: 'file',
          insecure: false,
          sessionId: null,
        }
      : null

    async function readLogin(): Promise<Login | null> {
      const doc = await file.read()
      return doc === null ? null : docToLogin(doc)
    }

    const current = async (): Promise<Login | null> => envLogin ?? readLogin()

    return {
      current,
      require: async () => {
        const login = await current()
        if (login === null)
          throw notLoggedIn(`no login saved in ${configDir}; ${ENV.ConfigDir} picks this folder`)
        return login
      },
      save: async (login: Login) => {
        if (fromEnv) {
          throw new BaseError({
            code: ErrorCode.UsageInvalidFlag,
            message: 'cannot save a login while DIFY_SERVER/DIFY_TOKEN are set',
          })
        }
        await file.update(() => loginToDoc(login))
      },
      clear: async () => {
        if (fromEnv) return
        await file.update(() => REMOVE)
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
