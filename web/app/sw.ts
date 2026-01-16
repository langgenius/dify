/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { CacheableResponsePlugin, CacheFirst, ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from 'serwist'

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

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  disableDevLogs: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) => url.origin === 'https://fonts.googleapis.com',
      handler: new CacheFirst({
        cacheName: 'google-fonts',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 4,
            maxAgeSeconds: 365 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    {
      matcher: ({ url }) => url.origin === 'https://fonts.gstatic.com',
      handler: new CacheFirst({
        cacheName: 'google-fonts-webfonts',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 4,
            maxAgeSeconds: 365 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    {
      matcher: ({ request }) => request.destination === 'image',
      handler: new CacheFirst({
        cacheName: 'images',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 64,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    {
      matcher: ({ request }) => request.destination === 'script' || request.destination === 'style',
      handler: new StaleWhileRevalidate({
        cacheName: 'static-resources',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 32,
            maxAgeSeconds: 24 * 60 * 60,
          }),
        ],
      }),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
      handler: new NetworkFirst({
        cacheName: 'api-cache',
        networkTimeoutSeconds: 10,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 16,
            maxAgeSeconds: 60 * 60,
          }),
        ],
      }),
    },
  ],
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
