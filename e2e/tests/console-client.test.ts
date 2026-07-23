import type { APIRequestContext, APIResponse } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { createConsoleClient } from '../support/api/console-client'
import { createPlaywrightFetch } from '../support/api/playwright-fetch'

const createApiResponse = ({
  body = '',
  headers = { 'content-type': 'application/json' },
  status = 200,
  statusText = 'OK',
  url = 'http://api.test/console/api/apps/app-1',
}: {
  body?: string
  headers?: Record<string, string>
  status?: number
  statusText?: string
  url?: string
} = {}): APIResponse => {
  const bodyBuffer = Buffer.from(body)

  return {
    body: async () => bodyBuffer,
    dispose: async () => {},
    headers: () => headers,
    headersArray: () => Object.entries(headers).map(([name, value]) => ({ name, value })),
    json: async () => JSON.parse(body),
    ok: () => status >= 200 && status < 300,
    securityDetails: async () => null,
    serverAddr: async () => null,
    status: () => status,
    statusText: () => statusText,
    text: async () => body,
    url: () => url,
    [Symbol.asyncDispose]: async () => {},
  }
}

const createRequestContext = (response: APIResponse, csrfToken = 'csrf-token') => {
  const fetch = vi.fn<APIRequestContext['fetch']>(async () => response)
  const context = {
    fetch,
    storageState: vi.fn<APIRequestContext['storageState']>(async () => ({
      cookies: [
        {
          domain: 'api.test',
          expires: -1,
          httpOnly: false,
          name: 'csrf_token',
          path: '/',
          sameSite: 'Lax',
          secure: false,
          value: csrfToken,
        },
      ],
      origins: [],
    })),
  } satisfies Pick<APIRequestContext, 'fetch' | 'storageState'>

  return { context, fetch }
}

const callPlaywrightFetch = (requestContext: Pick<APIRequestContext, 'fetch'>, request: Request) =>
  createPlaywrightFetch(requestContext)(request, {}, { context: {} }, ['test'], undefined)

describe('createPlaywrightFetch', () => {
  it('forwards the Fetch request without following redirects and returns a standard Response', async () => {
    const apiResponse = createApiResponse({
      body: '{"ok":true}',
      status: 201,
      statusText: 'Created',
    })
    const { context, fetch } = createRequestContext(apiResponse)
    const response = await callPlaywrightFetch(
      context,
      new Request('http://api.test/console/api/apps', {
        body: '{"name":"E2E App"}',
        headers: { 'content-type': 'application/json', 'x-test': 'value' },
        method: 'POST',
      }),
    )

    expect(fetch).toHaveBeenCalledWith(
      'http://api.test/console/api/apps',
      expect.objectContaining({
        data: Buffer.from('{"name":"E2E App"}'),
        failOnStatusCode: false,
        headers: expect.objectContaining({ 'content-type': 'application/json', 'x-test': 'value' }),
        maxRedirects: 0,
        method: 'POST',
      }),
    )
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('represents a 204 response without an invalid response body', async () => {
    const { context } = createRequestContext(createApiResponse({ body: '', status: 204 }))

    const response = await callPlaywrightFetch(
      context,
      new Request('http://api.test/console/api/apps/app-1', { method: 'DELETE' }),
    )

    expect(response.status).toBe(204)
    await expect(response.text()).resolves.toBe('')
  })

  it('forwards generated multipart bodies as raw bytes with their boundary', async () => {
    const { context, fetch } = createRequestContext(createApiResponse({ body: '{"ok":true}' }))
    const formData = new FormData()
    formData.append('pkg', new File(['plugin-package'], 'plugin.difypkg'))

    await callPlaywrightFetch(
      context,
      new Request('http://api.test/console/api/workspaces/current/plugin/upload/pkg', {
        body: formData,
        method: 'POST',
      }),
    )

    const options = fetch.mock.calls[0]?.[1]
    expect(options?.headers).toEqual(
      expect.objectContaining({ 'content-type': expect.stringContaining('multipart/form-data') }),
    )
    expect(Buffer.isBuffer(options?.data)).toBe(true)
    expect((options?.data as Buffer).toString()).toContain('plugin.difypkg')
    expect((options?.data as Buffer).toString()).toContain('plugin-package')
  })

  it('rejects redirects as an authentication or routing infrastructure failure', async () => {
    const dispose = vi.fn(async () => {})
    const { context } = createRequestContext({
      ...createApiResponse({
        body: '',
        headers: { location: 'http://web.test/signin' },
        status: 302,
        statusText: 'Found',
      }),
      dispose,
    })

    await expect(
      callPlaywrightFetch(context, new Request('http://api.test/console/api/apps')),
    ).rejects.toThrow('redirected with 302')
    expect(dispose).toHaveBeenCalledOnce()
  })
})

describe('createConsoleClient', () => {
  it('validates generated request inputs before transport', async () => {
    const { context, fetch } = createRequestContext(createApiResponse())
    const client = createConsoleClient({ apiBaseURL: 'http://api.test', requestContext: context })

    await expect(
      client.apps.byAppId.get({
        params: { app_id: 1 as unknown as string },
      }),
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects invalid generated multipart values before transport', async () => {
    const { context, fetch } = createRequestContext(createApiResponse())
    const client = createConsoleClient({ apiBaseURL: 'http://api.test', requestContext: context })

    await expect(
      client.workspaces.current.plugin.upload.pkg.post({
        body: { pkg: 1 as unknown as File },
      }),
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('validates server responses against the generated response schema', async () => {
    const { context } = createRequestContext(createApiResponse({ body: '{"id":1}' }))
    const client = createConsoleClient({ apiBaseURL: 'http://api.test', requestContext: context })

    await expect(
      client.apps.byAppId.get({ params: { app_id: '00000000-0000-4000-8000-000000000001' } }),
    ).rejects.toThrow()
  })

  it('adds the current CSRF token and accepts generated 204 responses', async () => {
    const { context, fetch } = createRequestContext(createApiResponse({ body: '', status: 204 }))
    const client = createConsoleClient({ apiBaseURL: 'http://api.test', requestContext: context })

    await expect(
      client.apps.byAppId.delete({
        params: { app_id: '00000000-0000-4000-8000-000000000001' },
      }),
    ).resolves.toBeUndefined()
    const requestHeaders = fetch.mock.calls[0]?.[1]?.headers
    expect(requestHeaders).toEqual(expect.objectContaining({ 'x-csrf-token': 'csrf-token' }))
  })

  it('rejects authenticated calls without a CSRF token before transport', async () => {
    const { context, fetch } = createRequestContext(createApiResponse(), '')
    const client = createConsoleClient({ apiBaseURL: 'http://api.test', requestContext: context })

    await expect(
      client.apps.byAppId.delete({
        params: { app_id: '00000000-0000-4000-8000-000000000001' },
      }),
    ).rejects.toThrow('requires an authenticated CSRF token')
    expect(fetch).not.toHaveBeenCalled()
  })
})
