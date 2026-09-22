import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }))

vi.mock('@/config', () => ({
  API_PREFIX: 'https://console.test/console/api',
  PUBLIC_API_PREFIX: 'https://console.test/api',
  MARKETPLACE_API_PREFIX: 'https://marketplace.test/api',
  CSRF_COOKIE_NAME: () => 'request-lifecycle-csrf',
  CSRF_HEADER_NAME: 'X-CSRF-Token',
  PASSPORT_HEADER_NAME: 'X-Passport',
  WEB_APP_SHARE_CODE_HEADER_NAME: 'X-App-Code',
  APP_VERSION: 'test',
  IS_MARKETPLACE: false,
  ACCESS_TOKEN_LOCAL_STORAGE_NAME: 'request-lifecycle-access-token',
  PASSPORT_LOCAL_STORAGE_NAME: (code: string) => `request-lifecycle-passport:${code}`,
}))
vi.mock('@/utils/var', () => ({ basePath: '' }))
vi.mock('@/app/notifications', () => ({ toast: { error: mocks.toastError } }))

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

type RequestAttempt = {
  bytes: Uint8Array<ArrayBuffer>
  contentType: string
  csrf: string | null
  keepalive: boolean
  credentials: RequestCredentials
}

function captureRefreshAndReplay(response: () => Response) {
  const attempts: RequestAttempt[] = []
  let refreshCount = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const outgoing = new Request(input, init)
    expect(outgoing.method).toBe('POST')
    expect(outgoing.credentials).toBe('include')
    if (outgoing.url === `${API_PREFIX}/refresh-token`) {
      refreshCount += 1
      document.cookie = `${CSRF_COOKIE_NAME()}=refreshed; path=/`
      return jsonResponse({ result: 'success' })
    }

    attempts.push({
      bytes: new Uint8Array(await outgoing.arrayBuffer()),
      contentType: outgoing.headers.get('Content-Type')!,
      csrf: outgoing.headers.get(CSRF_HEADER_NAME),
      keepalive: outgoing.keepalive,
      credentials: outgoing.credentials,
    })
    expect(outgoing.bodyUsed).toBe(true)
    return attempts.length === 1
      ? jsonResponse({ code: 'unauthorized', message: 'Session expired' }, 401)
      : response()
  })
  return { attempts, refreshCount: () => refreshCount }
}

function expectAuthenticatedReplay(network: ReturnType<typeof captureRefreshAndReplay>) {
  expect(network.refreshCount()).toBe(1)
  expect(network.attempts).toHaveLength(2)
  expect(network.attempts[1]!.bytes).toEqual(network.attempts[0]!.bytes)
  expect(network.attempts.map(({ csrf }) => csrf)).toEqual(['initial', 'refreshed'])
  for (const attempt of network.attempts) {
    expect(attempt.keepalive).toBe(true)
    expect(attempt.credentials).toBe('include')
  }
  expect(mocks.toastError).not.toHaveBeenCalled()
}

// Native Request consumption catches session-expiry failures on writes that happy-dom
// misses; keep oRPC encoding, base.request, Ky, and browser body handling real.
describe('Console write recovery with native request bodies', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.removeItem(`console-session-refresh:${API_PREFIX}`)
    document.cookie = `${CSRF_COOKIE_NAME()}=initial; path=/`
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.removeItem(`console-session-refresh:${API_PREFIX}`)
    document.cookie = `${CSRF_COOKIE_NAME()}=; path=/; max-age=0`
  })

  it('recovers a JSON write after session expiry with identical bytes, fresh CSRF, and keepalive', async () => {
    const audioBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0xff])
    const network = captureRefreshAndReplay(
      () => new Response(audioBytes, { headers: { 'Content-Type': 'audio/wav' } }),
    )
    const { consoleClient } = await import('./index')

    const result = await consoleClient.agent.byAgentId.textToAudio.post(
      { params: { agent_id: 'agent-1' }, body: { text: 'Hello 中文', voice: 'echo' } },
      { context: { keepalive: true } },
    )

    expectAuthenticatedReplay(network)
    expect(network.attempts[0]!.contentType).toBe('application/json')
    expect(new TextDecoder().decode(network.attempts[0]!.bytes)).toBe(
      JSON.stringify({ text: 'Hello 中文', voice: 'echo' }),
    )
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(audioBytes)
  })

  it('recovers a multipart import without losing its boundary, fields, filename, or file bytes', async () => {
    const archiveBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff])
    const network = captureRefreshAndReplay(() =>
      jsonResponse({ id: 'import-1', status: 'completed' }),
    )
    const { consoleClient } = await import('./index')

    const result = await consoleClient.apps.imports.post(
      {
        body: {
          app_id: 'existing-app',
          file: new File([archiveBytes], 'agent.ifpkg', { type: 'application/zip' }),
        },
      },
      { context: { keepalive: true } },
    )

    expect(result).toEqual({ id: 'import-1', status: 'completed' })
    expectAuthenticatedReplay(network)
    expect(network.attempts[1]!.contentType).toBe(network.attempts[0]!.contentType)
    for (const attempt of network.attempts) {
      expect(attempt.contentType).toContain('multipart/form-data; boundary=')
      const form = await new Response(attempt.bytes, {
        headers: { 'Content-Type': attempt.contentType },
      }).formData()
      expect(form.get('app_id')).toBe('existing-app')
      const file = form.get('file')
      expect(file).toBeInstanceOf(File)
      if (!(file instanceof File)) throw new TypeError('Expected the uploaded archive')
      expect(file.name).toBe('agent.ifpkg')
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(archiveBytes)
    }
  })
})
