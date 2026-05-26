import { join } from 'node:path'
import { FILE_NAME } from '../config/schema'
import { resolveConfigDir } from './dir'
import { YamlStore } from './store'

export const CACHE_DIR = 'cache'
export const CACHE_APP_INFO = 'app-info'
export const CACHE_NUDGE = 'nudge'

function getStore(filePath: string): YamlStore {
  return new YamlStore(filePath)
}

function resolveConfigurationPath(): string {
  return join(resolveConfigDir(), FILE_NAME)
}

export function cachePath(configDir: string, name: string): string {
  return join(configDir, CACHE_DIR, `${name}.yml`)
}

export function getConfigurationStore(): YamlStore {
  return getStore(resolveConfigurationPath())
}

export function getCache(cacheName: string): YamlStore {
  return getStore(cachePath(resolveConfigDir(), cacheName))
}
