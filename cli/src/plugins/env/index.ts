import { readTokenFile } from '@/auth/token-file'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { definePlugin } from '@/kernel/plugin'
import { resolveConfigDir } from '@/store/dir'
import { getEnv } from '@/sys'

export const ENV = {
  Server: 'DIFY_SERVER',
  Token: 'DIFY_TOKEN',
  TokenFile: 'DIFY_TOKEN_FILE',
  WorkspaceId: 'DIFY_WORKSPACE_ID',
  ConfigDir: 'DIFY_CONFIG_DIR',
  Output: 'DIFY_OUTPUT',
  // No longer read: the catalog lives in the config folder. Read only to say so.
  CacheDir: 'DIFY_CACHE_DIR',
  // difyctl v1's name for DIFY_SERVER; read only to name the rename.
  V1Host: 'DIFY_HOST',
} as const

export type EnvService = Readonly<{
  server?: string
  // Set when DIFY_TOKEN or DIFY_TOKEN_FILE supplies the login; the file is read on each call.
  readToken?: () => Promise<string>
  workspaceId?: string
  configDir: string
  cacheDirSet: boolean
}>

const HTTP_SCHEMES: readonly string[] = ['http:', 'https:']

function validateServer(server: string | undefined): void {
  if (server === undefined) return
  let url: URL
  try {
    url = new URL(server)
  } catch (cause) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `${ENV.Server} must be a valid http(s) URL, got "${server}"`,
      cause,
    })
  }
  if (!HTTP_SCHEMES.includes(url.protocol)) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `${ENV.Server} must use http or https, got "${server}"`,
    })
  }
}

type EnvCredential = Readonly<{
  variable: string
  read: () => Promise<string>
}>

function envCredential(): EnvCredential | undefined {
  const token = getEnv(ENV.Token)
  const tokenFile = getEnv(ENV.TokenFile)
  if (token !== undefined && tokenFile !== undefined) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `${ENV.Token} and ${ENV.TokenFile} cannot both be set`,
    })
  }
  if (token !== undefined) return { variable: ENV.Token, read: async () => token }
  if (tokenFile !== undefined)
    return { variable: ENV.TokenFile, read: () => readTokenFile(tokenFile) }
  return undefined
}

export const env = definePlugin({
  name: 'env',
  needs: [],
  build: (): EnvService => {
    const server = getEnv(ENV.Server)
    validateServer(server)
    const credential = envCredential()
    if (server === undefined && credential !== undefined) {
      throw new BaseError({
        code: ErrorCode.UsageInvalidFlag,
        message: `${credential.variable} requires ${ENV.Server} to be set`,
        hint:
          getEnv(ENV.V1Host) === undefined
            ? undefined
            : `${ENV.V1Host} was renamed to ${ENV.Server}; set ${ENV.Server} instead`,
      })
    }
    return Object.freeze({
      server,
      readToken: credential?.read,
      workspaceId: getEnv(ENV.WorkspaceId),
      configDir: resolveConfigDir(),
      cacheDirSet: getEnv(ENV.CacheDir) !== undefined,
    })
  },
})
