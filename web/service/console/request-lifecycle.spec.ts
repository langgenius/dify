import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}))

vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))
vi.mock('js-cookie', () => ({ default: { get: () => 'csrf-token' } }))
vi.mock('@/app/notifications', () => ({ toast: { error: mocks.toastError } }))

const originalLocation = globalThis.location
const initialHref = 'http://localhost:3000/apps?tab=recent#last-app'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const unauthorizedResponse = () =>
  jsonResponse({ code: 'unauthorized', message: 'Session expired', status: 401 }, 401)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const loadClient = async () => (await import('./index')).consoleClient
// oxlint-disable-next-line no-restricted-imports -- Exercise the public legacy cancellation contract through the real HTTP adapter.
const loadRequest = async () => (await import('../base')).request

function pendingUntilAborted(request: Request) {
  return new Promise<Response>((_resolve, reject) => {
    if (request.signal.aborted) reject(request.signal.reason)
    else
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
  })
}

describe('Console request lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: {
        origin: 'http://localhost:3000',
        pathname: '/apps',
        search: '?tab=recent',
        hash: '#last-app',
        href: initialHref,
        reload: vi.fn(),
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
  })

  it('rejects a second 401 without refreshing again and leaves its response body readable', async () => {
    let refreshCount = 0
    let requestCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const outgoing = new Request(input, init)
      if (new URL(outgoing.url).pathname.endsWith('/refresh-token')) {
        refreshCount += 1
        return jsonResponse({ result: 'success' })
      }
      requestCount += 1
      return unauthorizedResponse()
    })
    const client = await loadClient()

    const error = await client.agent.byAgentId
      .get({ params: { agent_id: 'agent-1' } })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Response)
    if (!(error instanceof Response)) throw new TypeError('Expected an HTTP response error')
    expect(error.status).toBe(401)
    expect(await error.json()).toMatchObject({ code: 'unauthorized', message: 'Session expired' })
    expect(refreshCount).toBe(1)
    expect(requestCount).toBe(2)
    expect(globalThis.location.href).toBe(initialHref)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('keeps a silent ordinary HTTP error readable without refreshing or notifying', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ code: 'provider_unavailable', message: 'Try again later' }, 503),
      )
    const client = await loadClient()

    const error = await client.agent.byAgentId
      .get({ params: { agent_id: 'agent-1' } }, { context: { silent: true } })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Response)
    if (!(error instanceof Response)) throw new TypeError('Expected an HTTP response error')
    expect(error.status).toBe(503)
    expect(await error.json()).toEqual({ code: 'provider_unavailable', message: 'Try again later' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(globalThis.location.href).toBe(initialHref)
  })

  it('cancels the initial generated request without refreshing, replaying, or navigating', async () => {
    const started = deferred<Request>()
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const outgoing = new Request(input, init)
      started.resolve(outgoing)
      return pendingUntilAborted(outgoing)
    })
    const controller = new AbortController()
    const client = await loadClient()
    const result = client.agent.byAgentId.get(
      { params: { agent_id: 'agent-1' } },
      { signal: controller.signal },
    )
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    const outgoing = await started.promise

    controller.abort()

    await rejection
    expect(outgoing.signal.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
    expect(globalThis.location.href).toBe(initialHref)
    expect(globalThis.location.reload).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it.each(['callback', 'caller'] as const)(
    'lets the %s controller cancel the initial request when both cancellation APIs are provided',
    async (source) => {
      const started = deferred<Request>()
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        const outgoing = new Request(input, init)
        started.resolve(outgoing)
        return pendingUntilAborted(outgoing)
      })
      const callerController = new AbortController()
      let callbackController: AbortController | undefined
      const request = await loadRequest()
      const result = request(
        '/agent/agent-1',
        { signal: callerController.signal },
        { getAbortController: (controller) => (callbackController = controller) },
      )
      const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
      const outgoing = await started.promise

      const controller = source === 'callback' ? callbackController : callerController
      expect(controller).toBeDefined()
      controller!.abort()

      await rejection
      expect(outgoing.signal.aborted).toBe(true)
      expect(fetch).toHaveBeenCalledOnce()
      expect(globalThis.location.href).toBe(initialHref)
      expect(globalThis.location.reload).not.toHaveBeenCalled()
      expect(mocks.toastError).not.toHaveBeenCalled()
    },
  )

  it.each(['callback', 'caller'] as const)(
    'keeps the original %s controller effective while replaying after refresh',
    async (source) => {
      const replayStarted = deferred<Request>()
      let refreshCount = 0
      let requestCount = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        const outgoing = new Request(input, init)
        if (new URL(outgoing.url).pathname.endsWith('/refresh-token')) {
          refreshCount += 1
          return Promise.resolve(jsonResponse({ result: 'success' }))
        }
        requestCount += 1
        if (requestCount === 1) return Promise.resolve(unauthorizedResponse())
        replayStarted.resolve(outgoing)
        return pendingUntilAborted(outgoing)
      })
      const callerController = new AbortController()
      let callbackController: AbortController | undefined
      const request = await loadRequest()
      const result = request(
        '/agent/agent-1',
        { signal: callerController.signal },
        {
          getAbortController: (controller) => {
            callbackController ??= controller
          },
        },
      )
      const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
      const outgoing = await replayStarted.promise

      const controller = source === 'callback' ? callbackController : callerController
      expect(controller).toBeDefined()
      controller!.abort()

      await rejection
      expect(outgoing.signal.aborted).toBe(true)
      expect(refreshCount).toBe(1)
      expect(requestCount).toBe(2)
      expect(globalThis.location.href).toBe(initialHref)
      expect(globalThis.location.reload).not.toHaveBeenCalled()
      expect(mocks.toastError).not.toHaveBeenCalled()
    },
  )

  it('cancels one refresh waiter without replaying it or disrupting another caller', async () => {
    const refresh = deferred<Response>()
    const attempts = new Map<string, number>()
    let refreshCount = 0
    let cancelledError: unknown
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const outgoing = new Request(input, init)
      const path = new URL(outgoing.url).pathname
      if (path.endsWith('/refresh-token')) {
        refreshCount += 1
        return refresh.promise
      }

      const count = (attempts.get(path) ?? 0) + 1
      attempts.set(path, count)
      if (count === 1) return unauthorizedResponse()
      return jsonResponse({ id: path.split('/').at(-1) })
    })
    const client = await loadClient()
    const controller = new AbortController()
    const cancelled = client.agent.byAgentId
      .get({ params: { agent_id: 'cancelled-agent' } }, { signal: controller.signal })
      .catch((error: unknown) => {
        cancelledError = error
      })
    const surviving = client.agent.byAgentId.get({ params: { agent_id: 'surviving-agent' } })

    try {
      await vi.waitFor(() => {
        expect(refreshCount).toBe(1)
        expect(attempts.size).toBe(2)
      })
      controller.abort()
      await vi.waitFor(() => {
        expect(cancelledError).toMatchObject({ name: 'AbortError' })
      })
      expect(globalThis.location.href).toBe(initialHref)
    } finally {
      refresh.resolve(jsonResponse({ result: 'success' }))
      await cancelled
      await surviving
    }

    expect(refreshCount).toBe(1)
    expect([...attempts].find(([path]) => path.endsWith('/cancelled-agent'))?.[1]).toBe(1)
    expect([...attempts].find(([path]) => path.endsWith('/surviving-agent'))?.[1]).toBe(2)
    expect(await surviving).toMatchObject({ id: 'surviving-agent' })
    expect(globalThis.location.href).toBe(initialHref)
    expect(globalThis.location.reload).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
