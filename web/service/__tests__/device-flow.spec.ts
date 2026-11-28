import Cookies from 'js-cookie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import {
  approveExternal,
  deviceApproveAccount,
  DeviceFlowError,
  deviceFlowErrorFrom,
  deviceLookup,
  fetchApprovalContext,
} from '../device-flow'

vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))

const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast }))

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
const requestOf = (index = 0) => {
  const [input, init] = fetchMock.mock.calls[index]!
  return new Request(input, init)
}

beforeEach(() => {
  fetchMock.mockReset()
  toast.error.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.history.replaceState({}, '', '/device')
})

afterEach(() => {
  vi.unstubAllGlobals()
  Cookies.remove(CSRF_COOKIE_NAME())
  window.history.replaceState({}, '', '/')
})

describe('deviceFlowErrorFrom', () => {
  it('prefers the error code from the body', () => {
    expect(deviceFlowErrorFrom(400, { error: 'expired_token' })).toMatchObject({
      code: 'expired_token',
      status: 400,
    })
  })

  it.each([
    [429, 'rate_limited'],
    [401, 'no_session'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [500, 'server_error'],
    [503, 'server_error'],
    [400, 'unknown'],
  ])('falls back to the status class for %i', (status, code) => {
    for (const body of [undefined, { code: 'too_many_requests', message: 'x' }, { error: '' }])
      expect(deviceFlowErrorFrom(status, body)).toMatchObject({ code, status })
  })
})

describe('account branch', () => {
  it('looks up a user code on the page origin', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ valid: true, expires_in_remaining: 600, client_id: 'cli' }),
    )

    await expect(deviceLookup('ABCD-3456')).resolves.toEqual({
      valid: true,
      expires_in_remaining: 600,
      client_id: 'cli',
    })
    const request = requestOf()
    expect(request.method).toBe('GET')
    expect(request.url).toBe(
      `${window.location.origin}/openapi/v1/oauth/device/lookup?user_code=ABCD-3456`,
    )
  })

  it('sends approvals with the console CSRF token', async () => {
    Cookies.set(CSRF_COOKIE_NAME(), 'console-csrf')
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'approved' }))

    await expect(deviceApproveAccount('ABCD-3456')).resolves.toEqual({ status: 'approved' })
    const request = requestOf()
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/openapi/v1/oauth/device/approve')
    expect(request.headers.get(CSRF_HEADER_NAME)).toBe('console-csrf')
    await expect(request.json()).resolves.toEqual({ user_code: 'ABCD-3456' })
  })

  it('maps the server error code without showing a toast', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'already_resolved' }, { status: 409 }))

    const error = await deviceApproveAccount('ABCD-3456').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DeviceFlowError)
    expect(error).toMatchObject({ code: 'already_resolved', status: 409 })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('maps a lookup rate limit from the status', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 'too_many_requests', message: 'Slow down' }, { status: 429 }),
    )

    await expect(deviceLookup('ABCD-3456')).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    })
  })

  it('stays on the device page when the console session cannot be refreshed', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/refresh-token'))
        return Response.json({ code: 'unauthorized' }, { status: 401 })
      return Response.json({ code: 'unauthorized', message: 'Login required' }, { status: 401 })
    })

    await expect(deviceApproveAccount('ABCD-3456')).rejects.toMatchObject({
      code: 'no_session',
      status: 401,
    })
    expect(window.location.pathname).toBe('/device')
  })

  it('passes network failures through unchanged', async () => {
    const failure = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValueOnce(failure)

    const error = await deviceLookup('ABCD-3456').catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(DeviceFlowError)
  })
})

describe('SSO branch', () => {
  it('sends the per-flow CSRF token instead of the console one', async () => {
    Cookies.set(CSRF_COOKIE_NAME(), 'console-csrf')
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'approved' }))

    await approveExternal(
      {
        subject_email: 'sso@example.com',
        subject_issuer: 'https://idp.example.com',
        user_code: 'ABCD-3456',
        csrf_token: 'flow-csrf',
        expires_at: '2026-01-01T00:00:00Z',
      },
      'ABCD-3456',
    )
    expect(requestOf().headers.get('X-CSRF-Token')).toBe('flow-csrf')
  })

  it('maps an approval-context failure from the status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

    await expect(fetchApprovalContext()).rejects.toMatchObject({
      code: 'no_session',
      status: 401,
    })
  })
})
