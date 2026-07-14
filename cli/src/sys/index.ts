import fs from 'node:fs'
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

export function unhandle(sig: string, handler: () => void) {
  process.off(sig, handler)
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
  atomicReplace: (src: string, dst: string) => void
}

export const SUBDIR = 'difyctl'
export const ENV_XDG_CONFIG_HOME = 'XDG_CONFIG_HOME'
export const ENV_XDG_CACHE_HOME = 'XDG_CACHE_HOME'

function appDataDir(): string | undefined {
  return getEnv('APPDATA') ?? getEnv('LOCALAPPDATA')
}

type PlatformFactory = () => Platform

function posixAtomicReplace(src: string, dst: string): void {
  fs.renameSync(src, dst)
}

function win32AtomicReplace(src: string, dst: string): void {
  try {
    fs.unlinkSync(dst)
  } catch {}
  fs.renameSync(src, dst)
}

const platformImpls: Partial<Record<NodeJS.Platform, PlatformFactory>> = {
  linux: () => ({
    id: () => 'linux',
    configDir: () => {
      const xdg = getEnv(ENV_XDG_CONFIG_HOME)
      return xdg !== undefined && xdg !== ''
        ? join(xdg, SUBDIR)
        : join(homedir(), '.config', SUBDIR)
    },
    cacheDir: () => {
      const xdg = getEnv(ENV_XDG_CACHE_HOME)
      return xdg !== undefined && xdg !== '' ? join(xdg, SUBDIR) : join(homedir(), '.cache', SUBDIR)
    },
    atomicReplace: posixAtomicReplace,
  }),
  darwin: () => ({
    id: () => 'darwin',
    configDir: () => join(homedir(), '.config', SUBDIR),
    cacheDir: () => join(homedir(), 'Library', 'Caches', SUBDIR),
    atomicReplace: posixAtomicReplace,
  }),
  win32: () => ({
    id: () => 'win32',
    configDir: () => {
      const appData = appDataDir()
      if (appData === undefined || appData === '')
        throw new Error('cannot resolve %APPDATA% on Windows')
      return join(appData, SUBDIR)
    },
    cacheDir: () => {
      const appData = appDataDir()
      if (appData === undefined || appData === '')
        throw new Error('cannot resolve %LOCALAPPDATA% on Windows')
      return join(appData, SUBDIR)
    },
    atomicReplace: win32AtomicReplace,
  }),
}

const defaultPlatformFactory: PlatformFactory = () => ({
  id: () => platform(),
  configDir: () => join(homedir(), '.config', SUBDIR),
  cacheDir: () => join(homedir(), '.cache', SUBDIR),
  atomicReplace: posixAtomicReplace,
})

export function resolvePlatform(): Platform {
  return (platformImpls[platform()] ?? defaultPlatformFactory)()
}
