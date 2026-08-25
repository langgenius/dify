const { mockConfig, mockCreateInstance, mockWebAppClient } = vi.hoisted(() => {
  const mockWebAppClient = {
    init: vi.fn(),
    setOptOut: vi.fn(),
    track: vi.fn(),
  }

  return {
    mockConfig: {
      AMPLITUDE_API_KEY: 'test-api-key',
    },
    mockCreateInstance: vi.fn(() => mockWebAppClient),
    mockWebAppClient,
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
    mockConfig.AMPLITUDE_API_KEY = 'test-api-key'
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
      instanceName: 'webapp',
    })
  })

  it('preserves the first consented event while the SDK initializes', async () => {
    setWebAppAmplitudeOptOut(false)
    const pendingEvent = sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'agent-v2' })

    expect(mockWebAppClient.track).not.toHaveBeenCalled()
    await pendingEvent

    expect(mockWebAppClient.setOptOut).toHaveBeenCalledWith(false)
    expect(mockWebAppClient.track).toHaveBeenCalledWith('webapp_run', {
      app_mode: 'agent-v2',
    })
  })

  it('drops a pending event when consent is withdrawn before initialization completes', async () => {
    setWebAppAmplitudeOptOut(false)
    const pendingEvent = sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'workflow' })
    setWebAppAmplitudeOptOut(true)

    await pendingEvent

    expect(mockWebAppClient.setOptOut).toHaveBeenLastCalledWith(true)
    expect(mockWebAppClient.track).not.toHaveBeenCalled()
  })

  it('does not initialize when Amplitude is disabled', async () => {
    mockConfig.AMPLITUDE_API_KEY = ''

    await ensureWebAppAmplitudeInitialized()
    await sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'chatflow' })

    expect(mockWebAppClient.init).not.toHaveBeenCalled()
    expect(mockWebAppClient.track).not.toHaveBeenCalled()
  })
})
