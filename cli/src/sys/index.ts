import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function getEnv(name: string): string | undefined {
  return process.env[name]
}

export type EmbeddedFile = Blob & { readonly name: string }

type BunGlobal = { embeddedFiles?: readonly EmbeddedFile[] }

export function embeddedFiles(): readonly EmbeddedFile[] {
  return (globalThis as { Bun?: BunGlobal }).Bun?.embeddedFiles ?? []
}

export function isCompiledBinary(): boolean {
  return __DIFYCTL_COMPILED__
}

export function env(): NodeJS.ProcessEnv {
  return process.env
}

export function argv(): readonly string[] {
  return process.argv.slice(2)
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
  atomicReplace: (src: string, dst: string) => void
}

export const SUBDIR = 'difyctl'
export const ENV_XDG_CONFIG_HOME = 'XDG_CONFIG_HOME'

const APP_DATA_VARS = ['APPDATA', 'LOCALAPPDATA'] as const

// The first of these that is set.
function appDataDir(): string {
  const dir = APP_DATA_VARS.map(getEnv).find((value) => value !== undefined && value !== '')
  if (dir === undefined)
    throw new Error(
      `cannot resolve ${APP_DATA_VARS.map((name) => `%${name}%`).join(' or ')} on Windows`,
    )
  return join(dir, SUBDIR)
}

type PlatformFactory = () => Platform

function posixAtomicReplace(src: string, dst: string): void {
  fs.renameSync(src, dst)
}

function win32AtomicReplace(src: string, dst: string): void {
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
    atomicReplace: posixAtomicReplace,
  }),
  darwin: () => ({
    id: () => 'darwin',
    configDir: () => join(homedir(), '.config', SUBDIR),
    atomicReplace: posixAtomicReplace,
  }),
  win32: () => ({
    id: () => 'win32',
    configDir: appDataDir,
    atomicReplace: win32AtomicReplace,
  }),
}

const defaultPlatformFactory: PlatformFactory = () => ({
  id: () => platform(),
  configDir: () => join(homedir(), '.config', SUBDIR),
  atomicReplace: posixAtomicReplace,
})

export function resolvePlatform(): Platform {
  return (platformImpls[platform()] ?? defaultPlatformFactory)()
}
