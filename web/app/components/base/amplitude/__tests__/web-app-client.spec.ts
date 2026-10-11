import type { Types } from '@amplitude/analytics-browser'

const TEST_API_KEY = 'test-api-key'
const CONSOLE_IDENTITY_COOKIE_NAME = `AMP_${TEST_API_KEY.slice(0, 10)}`
const CONSOLE_UNSENT_EVENTS_KEY = `AMP_unsent_${TEST_API_KEY.slice(0, 10)}`

const { mockConfig, mockCreateInstance, mockIdentity, mockTrackedEvents, mockWebAppClient } =
  vi.hoisted(() => {
    const identity = {
      userId: undefined as string | undefined,
    }
    const trackedEvents: Array<{
      eventName: string
      properties: Record<string, unknown>
      userId: string | undefined
    }> = []
    const mockWebAppClient = {
      init: vi.fn((apiKey: string, options?: Types.BrowserOptions) => {
        const identityCookieName = `AMP_${apiKey.slice(0, 10)}=`
        const identityCookie = document.cookie
          .split(';')
          .map((cookie) => cookie.trim())
          .find((cookie) => cookie.startsWith(identityCookieName))

        identity.userId =
          options?.identityStorage === 'none'
            ? undefined
            : identityCookie
              ? decodeURIComponent(identityCookie.slice(identityCookieName.length))
              : undefined
      }),
      setOptOut: vi.fn(),
      track: vi.fn((eventName: string, properties: Record<string, unknown>) => {
        trackedEvents.push({ eventName, properties, userId: identity.userId })
      }),
    }

    return {
      mockConfig: {
        AMPLITUDE_API_KEY: 'test-api-key',
      },
      mockCreateInstance: vi.fn(() => mockWebAppClient),
      mockWebAppClient,
      mockIdentity: identity,
      mockTrackedEvents: trackedEvents,
    }
  })

let ensureWebAppAmplitudeInitialized: typeof import('../web-app-client').ensureWebAppAmplitudeInitialized
let sendWebAppAmplitudeEvent: typeof import('../web-app-client').sendWebAppAmplitudeEvent
let setWebAppAmplitudeOptOut: typeof import('../web-app-client').setWebAppAmplitudeOptOut

vi.mock('@/config', () => ({
  get AMPLITUDE_API_KEY() {
    return mockConfig.AMPLITUDE_API_KEY
  },
}))

vi.mock('@amplitude/analytics-browser', () => ({
  createInstance: mockCreateInstance,
}))

describe('WebApp Amplitude client', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    document.cookie = `${CONSOLE_IDENTITY_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    mockConfig.AMPLITUDE_API_KEY = TEST_API_KEY
    mockIdentity.userId = undefined
    mockTrackedEvents.length = 0
    ;({ ensureWebAppAmplitudeInitialized, sendWebAppAmplitudeEvent, setWebAppAmplitudeOptOut } =
      await import('../web-app-client'))
  })

  it('loads the SDK lazily and initializes one dedicated instance', async () => {
    expect(mockCreateInstance).not.toHaveBeenCalled()

    await Promise.all([ensureWebAppAmplitudeInitialized(), ensureWebAppAmplitudeInitialized()])

    expect(mockCreateInstance).toHaveBeenCalledTimes(1)
    expect(mockWebAppClient.init).toHaveBeenCalledTimes(1)
    expect(mockWebAppClient.init).toHaveBeenCalledWith('test-api-key', {
      autocapture: false,
      defaultTracking: false,
      fetchRemoteConfig: false,
      flushQueueSize: 1,
      identityStorage: 'none',
      instanceName: 'webapp',
      optOut: true,
      storageProvider: expect.any(Object),
    })
  })

  it('preserves the first consented event while the SDK initializes', async () => {
    setWebAppAmplitudeOptOut(false)
    const pendingEvent = sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'agent-v2' })

    expect(mockWebAppClient.track).not.toHaveBeenCalled()
    await pendingEvent

    expect(mockWebAppClient.init).toHaveBeenCalledWith(
      TEST_API_KEY,
      expect.objectContaining({ optOut: false }),
    )
    expect(mockWebAppClient.setOptOut).not.toHaveBeenCalled()
    expect(mockWebAppClient.track).toHaveBeenCalledWith('webapp_run', {
      app_mode: 'agent-v2',
    })
  })

  it('drops a pending event when consent is withdrawn before initialization completes', async () => {
    setWebAppAmplitudeOptOut(false)
    const pendingEvent = sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'workflow' })
    setWebAppAmplitudeOptOut(true)

    await pendingEvent

    expect(mockWebAppClient.init).toHaveBeenCalledWith(
      TEST_API_KEY,
      expect.objectContaining({ optOut: true }),
    )
    expect(mockWebAppClient.setOptOut).not.toHaveBeenCalled()
    expect(mockWebAppClient.track).not.toHaveBeenCalled()
  })

  it('does not inherit the console identity or unsent-event queue', async () => {
    document.cookie = `${CONSOLE_IDENTITY_COOKIE_NAME}=${encodeURIComponent('builder@example.com')}; path=/`
    localStorage.setItem(
      CONSOLE_UNSENT_EVENTS_KEY,
      JSON.stringify([{ event_type: 'console_event', user_id: 'builder@example.com' }]),
    )

    setWebAppAmplitudeOptOut(false)
    await sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'workflow' })

    expect(mockTrackedEvents).toEqual([
      {
        eventName: 'webapp_run',
        properties: { app_mode: 'workflow' },
        userId: undefined,
      },
    ])

    const initOptions = mockWebAppClient.init.mock.calls[0]?.[1]
    const storageProvider = initOptions?.storageProvider
    expect(storageProvider).toBeDefined()
    await expect(storageProvider?.get(CONSOLE_UNSENT_EVENTS_KEY)).resolves.toBeUndefined()

    await storageProvider?.set(CONSOLE_UNSENT_EVENTS_KEY, [])
    await expect(storageProvider?.get(CONSOLE_UNSENT_EVENTS_KEY)).resolves.toEqual([])
    expect(localStorage.getItem(CONSOLE_UNSENT_EVENTS_KEY)).not.toBeNull()
    expect(localStorage).toHaveLength(1)
  })

  it('does not initialize when Amplitude is disabled', async () => {
    mockConfig.AMPLITUDE_API_KEY = ''

    await ensureWebAppAmplitudeInitialized()
    await sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'chatflow' })

    expect(mockWebAppClient.init).not.toHaveBeenCalled()
    expect(mockWebAppClient.track).not.toHaveBeenCalled()
  })
})
