import { homedir } from 'node:os'
import { join } from 'node:path'
import { getEnv, platform } from '../sys'

export const ENV_CONFIG_DIR = 'DIFY_CONFIG_DIR'
export const ENV_XDG_CONFIG_HOME = 'XDG_CONFIG_HOME'
export const ENV_CACHE_DIR = 'DIFY_CACHE_DIR'
export const ENV_XDG_CACHE_HOME = 'XDG_CACHE_HOME'
export const SUBDIR = 'difyctl'
export const FILE_PERM = 0o600
export const DIR_PERM = 0o700

export type ConfigEnvironment = {
  readonly getEnv: (name: string) => string | undefined
  readonly homeDir: () => string
  readonly platform: () => NodeJS.Platform
  readonly appData: () => string | undefined
}

export const realEnvironment: ConfigEnvironment = {
  getEnv,
  homeDir: () => homedir(),
  platform: () => platform(),
  appData: () => getEnv('APPDATA') ?? getEnv('LOCALAPPDATA'),
}

export function resolveCacheDir(env: ConfigEnvironment = realEnvironment): string {
  const override = env.getEnv(ENV_CACHE_DIR)
  if (override !== undefined && override !== '')
    return override

  const platform = env.platform()
  if (platform === 'linux') {
    const xdg = env.getEnv(ENV_XDG_CACHE_HOME)
    if (xdg !== undefined && xdg !== '')
      return join(xdg, SUBDIR)
    return join(env.homeDir(), '.cache', SUBDIR)
  }
  if (platform === 'darwin')
    return join(env.homeDir(), 'Library', 'Caches', SUBDIR)
  if (platform === 'win32') {
    const appData = env.appData()
    if (appData === undefined || appData === '')
      throw new Error('cannot resolve %LOCALAPPDATA% on Windows')
    return join(appData, SUBDIR)
  }
  return join(env.homeDir(), '.cache', SUBDIR)
}

export function resolveConfigDir(env: ConfigEnvironment = realEnvironment): string {
  const override = env.getEnv(ENV_CONFIG_DIR)
  if (override !== undefined && override !== '')
    return override

  const platform = env.platform()
  if (platform === 'linux') {
    const xdg = env.getEnv(ENV_XDG_CONFIG_HOME)
    if (xdg !== undefined && xdg !== '')
      return join(xdg, SUBDIR)
    return join(env.homeDir(), '.config', SUBDIR)
  }
  if (platform === 'darwin')
    return join(env.homeDir(), '.config', SUBDIR)
  if (platform === 'win32') {
    const appData = env.appData()
    if (appData === undefined || appData === '')
      throw new Error('cannot resolve %APPDATA% on Windows')
    return join(appData, SUBDIR)
  }
  return join(env.homeDir(), '.config', SUBDIR)
}
