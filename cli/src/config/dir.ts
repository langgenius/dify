import { homedir } from 'node:os'
import { join } from 'node:path'

export const ENV_CONFIG_DIR = 'DIFY_CONFIG_DIR'
export const ENV_XDG_CONFIG_HOME = 'XDG_CONFIG_HOME'
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
  getEnv: name => process.env[name],
  homeDir: () => homedir(),
  platform: () => process.platform,
  appData: () => process.env.APPDATA ?? process.env.LOCALAPPDATA,
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
