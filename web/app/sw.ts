/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { defaultCache } from '@serwist/turbopack/worker'
import { Serwist } from 'serwist'
import { withLeadingSlash } from 'ufo'

declare global {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const scopePathname = new URL(self.registration.scope).pathname
const basePath = scopePathname.replace(/\/serwist\/$/, '').replace(/\/$/, '')
const offlineUrl = `${basePath}/_offline.html`

const normalizeManifestUrl = (url: string): string => {
  if (url.startsWith('/serwist/'))
    return url.replace(/^\/serwist\//, '/')

  return withLeadingSlash(url)
}

const manifest = self.__SW_MANIFEST?.map((entry) => {
  if (typeof entry === 'string')
    return normalizeManifestUrl(entry)

  return {
    ...entry,
    url: normalizeManifestUrl(entry.url),
  }
})

const serwist = new Serwist({
  precacheEntries: manifest,
  skipWaiting: true,
  disableDevLogs: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: offlineUrl,
        matcher({ request }) {
          return request.destination === 'document'
        },
      },
    ],
  },
})

serwist.addEventListeners()
