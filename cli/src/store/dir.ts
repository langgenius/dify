import type { ConfigEnvironment } from '../sys'
import { realEnvironment, resolvePlatform } from '../sys'

export const ENV_CONFIG_DIR = 'DIFY_CONFIG_DIR'
export const ENV_CACHE_DIR = 'DIFY_CACHE_DIR'
export const FILE_PERM = 0o600
export const DIR_PERM = 0o700

export function resolveCacheDir(env: ConfigEnvironment = realEnvironment): string {
  const override = env.getEnv(ENV_CACHE_DIR)
  if (override !== undefined && override !== '')
    return override
  return resolvePlatform(env).cacheDir()
}

export function resolveConfigDir(env: ConfigEnvironment = realEnvironment): string {
  const override = env.getEnv(ENV_CONFIG_DIR)
  if (override !== undefined && override !== '')
    return override
  return resolvePlatform(env).configDir()
}
