// @vitest-environment node

import type { DehydratedState } from '@tanstack/react-query'
import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import {
  dehydrate,
  HydrationBoundary,
  QueryClientProvider,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Suspense } from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { getQueryClient } from '@/app/get-query-client'
import { consoleQuery } from '@/service/console'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import './server'

vi.mock('server-only', () => ({}))
vi.mock('@/config', () => ({
  API_PREFIX: '/console/api',
  CSRF_COOKIE_NAME: () => 'csrf_token',
  CSRF_HEADER_NAME: 'X-CSRF-Token',
}))
vi.mock('@/config/server', () => ({
  SERVER_CONSOLE_API_PREFIX: 'https://internal.example/console/api',
}))
vi.mock('@/next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}))

const options = () => consoleQuery.systemFeatures.get.queryOptions()

function Consumer() {
  const { data } = useSuspenseQuery(options())
  return <p>{data.deployment_edition}</p>
}

function render(queryClient: ReturnType<typeof getQueryClient>, state: DehydratedState) {
  return new Promise<string>((resolve, reject) => {
    const output = new PassThrough()
    const chunks: Buffer[] = []
    output.on('data', (chunk) => chunks.push(chunk))
    output.on('end', () => resolve(Buffer.concat(chunks).toString()))
    const stream = renderToPipeableStream(
      <QueryClientProvider client={queryClient}>
        <HydrationBoundary state={state}>
          <Suspense fallback={<p>Loading</p>}>
            <Consumer />
          </Suspense>
        </HydrationBoundary>
      </QueryClientProvider>,
      {
        onAllReady() {
          stream.pipe(output)
        },
        onError: reject,
      },
    )
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('Console Suspense hydration contract', () => {
  it('renders a prefetched Suspense result without requesting it again', async () => {
    let resolveResponse!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const fetch = vi.fn(() => response)
    vi.stubGlobal('fetch', fetch)
    const preloadClient = getQueryClient()
    const pending = preloadClient.query(options())
    const state = dehydrate(preloadClient)
    const html = render(getQueryClient(), state)
    const data = createSystemFeaturesFixture()
    resolveResponse(Response.json(data))

    await expect(html).resolves.toContain(data.deployment_edition)
    await pending
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
