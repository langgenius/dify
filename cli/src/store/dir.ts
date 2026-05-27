import { getEnv, resolvePlatform } from '../sys'

export const ENV_CONFIG_DIR = 'DIFY_CONFIG_DIR'
export const ENV_CACHE_DIR = 'DIFY_CACHE_DIR'
export const FILE_PERM = 0o600
export const DIR_PERM = 0o700

export function resolveCacheDir(): string {
  const override = getEnv(ENV_CACHE_DIR)
  if (override !== undefined && override !== '')
    return override
  return resolvePlatform().cacheDir()
}

export function resolveConfigDir(): string {
  const override = getEnv(ENV_CONFIG_DIR)
  if (override !== undefined && override !== '')
    return override
  return resolvePlatform().configDir()
}
