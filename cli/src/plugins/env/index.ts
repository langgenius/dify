import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { definePlugin } from '@/kernel/plugin'
import { resolveCacheDir, resolveConfigDir } from '@/store/dir'
import { getEnv } from '@/sys'

export const ENV = {
  Server: 'DIFY_SERVER',
  Token: 'DIFY_TOKEN',
  WorkspaceId: 'DIFY_WORKSPACE_ID',
  ConfigDir: 'DIFY_CONFIG_DIR',
  CacheDir: 'DIFY_CACHE_DIR',
} as const

export type EnvService = Readonly<{
  server?: string
  token?: string
  workspaceId?: string
  configDir: string
  cacheDir: string
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

export const env = definePlugin({
  name: 'env',
  needs: [],
  build: (): EnvService => {
    const server = getEnv(ENV.Server)
    const token = getEnv(ENV.Token)
    validateServer(server)
    if (server === undefined && token !== undefined) {
      throw new BaseError({
        code: ErrorCode.UsageInvalidFlag,
        message: `${ENV.Token} requires ${ENV.Server} to be set`,
      })
    }
    return Object.freeze({
      server,
      token,
      workspaceId: getEnv(ENV.WorkspaceId),
      configDir: resolveConfigDir(),
      cacheDir: resolveCacheDir(),
    })
  },
})
