import * as amplitude from '@amplitude/analytics-browser'

const { mockConfig, mockWebAppClient } = vi.hoisted(() => ({
  mockConfig: {
    AMPLITUDE_API_KEY: 'test-api-key',
  },
  mockWebAppClient: {
    init: vi.fn(),
    setOptOut: vi.fn(),
    track: vi.fn(),
  },
}))

let ensureWebAppAmplitudeInitialized: typeof import('../web-app-client').ensureWebAppAmplitudeInitialized
let sendWebAppAmplitudeEvent: typeof import('../web-app-client').sendWebAppAmplitudeEvent
let setWebAppAmplitudeOptOut: typeof import('../web-app-client').setWebAppAmplitudeOptOut

vi.mock('@/config', () => ({
  get AMPLITUDE_API_KEY() {
    return mockConfig.AMPLITUDE_API_KEY
  },
}))

vi.mock('@amplitude/analytics-browser', () => ({
  createInstance: vi.fn(() => mockWebAppClient),
}))

describe('WebApp Amplitude client', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockConfig.AMPLITUDE_API_KEY = 'test-api-key'
    ;({ ensureWebAppAmplitudeInitialized, sendWebAppAmplitudeEvent, setWebAppAmplitudeOptOut } =
      await import('../web-app-client'))
  })

  it('initializes a dedicated instance with all automatic tracking disabled', () => {
    ensureWebAppAmplitudeInitialized()
    ensureWebAppAmplitudeInitialized()

    expect(amplitude.createInstance).toHaveBeenCalledTimes(1)
    expect(mockWebAppClient.init).toHaveBeenCalledTimes(1)
    expect(mockWebAppClient.init).toHaveBeenCalledWith('test-api-key', {
      autocapture: false,
      defaultTracking: false,
      fetchRemoteConfig: false,
      instanceName: 'webapp',
    })
  })

  it('sends explicit events and opt-out updates only after initialization', () => {
    sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'agent-v2' })
    setWebAppAmplitudeOptOut(true)
    expect(mockWebAppClient.track).not.toHaveBeenCalled()
    expect(mockWebAppClient.setOptOut).not.toHaveBeenCalled()

    ensureWebAppAmplitudeInitialized()
    setWebAppAmplitudeOptOut(false)
    sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'agent-v2' })

    expect(mockWebAppClient.setOptOut).toHaveBeenCalledWith(false)
    expect(mockWebAppClient.track).toHaveBeenCalledWith('webapp_run', {
      app_mode: 'agent-v2',
    })
  })

  it('does not initialize when Amplitude is disabled', () => {
    mockConfig.AMPLITUDE_API_KEY = ''

    ensureWebAppAmplitudeInitialized()
    sendWebAppAmplitudeEvent('webapp_run', { app_mode: 'chatflow' })

    expect(mockWebAppClient.init).not.toHaveBeenCalled()
    expect(mockWebAppClient.track).not.toHaveBeenCalled()
  })
})
