/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { defaultCache } from '@serwist/turbopack/worker'
import { Serwist } from 'serwist'

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

const manifest = self.__SW_MANIFEST?.map((entry) => {
  if (typeof entry === 'string') {
    if (entry.startsWith('/serwist/'))
      return entry.replace(/^\/serwist\//, '/')
    if (!entry.startsWith('/'))
      return `/${entry}`
    return entry
  }

  const url = entry.url
  let newUrl = url

  if (url.startsWith('/serwist/'))
    newUrl = url.replace(/^\/serwist\//, '/')
  else if (!url.startsWith('/'))
    newUrl = `/${url}`

  return {
    ...entry,
    url: newUrl,
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
