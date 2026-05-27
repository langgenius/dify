import { homedir } from 'node:os'
import { join } from 'node:path'

export function getEnv(name: string): string | undefined {
  return process.env[name]
}

export function env(): NodeJS.ProcessEnv {
  return process.env
}

export function processExit(code: number): never {
  return process.exit(code) as never
}

export function io() {
  return {
    out: process.stdout,
    err: process.stderr,
    in: process.stdin,
    isOutTTY: Boolean(process.stdout.isTTY),
    isErrTTY: Boolean(process.stderr.isTTY),
  }
}

export function handle(sig: string, handler: () => void) {
  process.once(sig, handler)
}

export function platform(): NodeJS.Platform {
  return process.platform
}

export function arch(): string {
  return process.arch
}

export function pid(): number {
  return Number(process.pid)
}

export type Platform = {
  id: () => NodeJS.Platform
  configDir: () => string
  cacheDir: () => string
}

export const SUBDIR = 'difyctl'
export const ENV_XDG_CONFIG_HOME = 'XDG_CONFIG_HOME'
export const ENV_XDG_CACHE_HOME = 'XDG_CACHE_HOME'

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

type PlatformFactory = (env: ConfigEnvironment) => Platform

const platformImpls: Partial<Record<NodeJS.Platform, PlatformFactory>> = {
  linux: env => ({
    id: () => 'linux',
    configDir: () => {
      const xdg = env.getEnv(ENV_XDG_CONFIG_HOME)
      return (xdg !== undefined && xdg !== '') ? join(xdg, SUBDIR) : join(env.homeDir(), '.config', SUBDIR)
    },
    cacheDir: () => {
      const xdg = env.getEnv(ENV_XDG_CACHE_HOME)
      return (xdg !== undefined && xdg !== '') ? join(xdg, SUBDIR) : join(env.homeDir(), '.cache', SUBDIR)
    },
  }),
  darwin: env => ({
    id: () => 'darwin',
    configDir: () => join(env.homeDir(), '.config', SUBDIR),
    cacheDir: () => join(env.homeDir(), 'Library', 'Caches', SUBDIR),
  }),
  win32: env => ({
    id: () => 'win32',
    configDir: () => {
      const appData = env.appData()
      if (appData === undefined || appData === '')
        throw new Error('cannot resolve %APPDATA% on Windows')
      return join(appData, SUBDIR)
    },
    cacheDir: () => {
      const appData = env.appData()
      if (appData === undefined || appData === '')
        throw new Error('cannot resolve %LOCALAPPDATA% on Windows')
      return join(appData, SUBDIR)
    },
  }),
}

const defaultPlatformFactory: PlatformFactory = env => ({
  id: () => env.platform(),
  configDir: () => join(env.homeDir(), '.config', SUBDIR),
  cacheDir: () => join(env.homeDir(), '.cache', SUBDIR),
})

export function resolvePlatform(env: ConfigEnvironment): Platform {
  return (platformImpls[env.platform()] ?? defaultPlatformFactory)(env)
}
