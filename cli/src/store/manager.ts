import type { Store } from './store'
import { join } from 'node:path'
import { FILE_NAME } from '../config/schema'
import { resolveCacheDir, resolveConfigDir } from './dir'
import { YamlStore } from './store'

export const CACHE_APP_INFO = 'app-info'
export const CACHE_NUDGE = 'nudge'

function getStore(filePath: string): YamlStore {
  return new YamlStore(filePath)
}

function resolveConfigurationPath(): string {
  return join(resolveConfigDir(), FILE_NAME)
}

export function cachePath(cacheDir: string, name: string): string {
  return join(cacheDir, `${name}.yml`)
}

export function getConfigurationStore(): YamlStore {
  return getStore(resolveConfigurationPath())
}

export function getCache(cacheName: string): Store {
  return getStore(cachePath(resolveCacheDir(), cacheName))
}
