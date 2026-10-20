import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { REGISTRATION_SUCCESS_STORAGE_KEY } from '@/app/components/base/amplitude/registration-session-state'
import { consoleQueryKey } from '@/test/console/operation-hooks'

let queryClient: QueryClient
const systemFeaturesQueryKey = consoleQueryKey('systemFeatures.get')

type ConfigState = {
  cookieYesSiteKey: string
  isProd: boolean
  webPrefix: string | undefined
}

const { configState, mockHeadersGet, mockBoundary } = vi.hoisted(() => ({
  configState: {
    cookieYesSiteKey: 'site-key',
    isProd: true,
    webPrefix: 'https://cloud.dify.ai',
  } as ConfigState,
  mockHeadersGet: vi.fn(),
  mockBoundary: vi.fn(),
}))

vi.mock('@/features/system-features/server', () => ({
  getOptionalSystemFeatures: async () => queryClient.getQueryData(systemFeaturesQueryKey),
}))

vi.mock('@/config', () => ({
  get COOKIEYES_SITE_KEY() {
    return configState.cookieYesSiteKey
  },
  get IS_PROD() {
    return configState.isProd
  },
  get WEB_PREFIX() {
    return configState.webPrefix
  },
}))

vi.mock('@/next/headers', () => ({
  headers: async () => ({ get: mockHeadersGet }),
}))

vi.mock('../cloud-analytics-layout-boundary', () => ({
  CloudAnalyticsLayoutBoundary: (props: { cookieYesSiteKey: string; nonce?: string }) => {
    mockBoundary(props)
    return null
  },
}))

async function getCloudAnalyticsResult() {
  const { CloudAnalytics } = await import('../cloud-analytics')
  return CloudAnalytics()
}

async function renderCloudAnalytics() {
  return render(await getCloudAnalyticsResult())
}

describe('CloudAnalytics', () => {
  let previousRegistration: string | null

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    configState.cookieYesSiteKey = 'site-key'
    configState.isProd = true
    configState.webPrefix = 'https://cloud.dify.ai'
    queryClient = new QueryClient()
    previousRegistration = window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)
    window.sessionStorage.removeItem(REGISTRATION_SUCCESS_STORAGE_KEY)
    queryClient.setQueryData(systemFeaturesQueryKey, { deployment_edition: 'CLOUD' })
    mockHeadersGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        host: 'cloud.dify.ai',
        'x-nonce': 'test-nonce',
      }
      return values[name] ?? null
    })
  })

  afterEach(() => {
    if (previousRegistration === null)
      window.sessionStorage.removeItem(REGISTRATION_SUCCESS_STORAGE_KEY)
    else window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, previousRegistration)
    queryClient.clear()
  })

  it('mounts the layout boundary for an eligible Cloud request', async () => {
    await renderCloudAnalytics()
    expect(mockBoundary).toHaveBeenCalledWith({ cookieYesSiteKey: 'site-key', nonce: 'test-nonce' })
  })

  it('does not render on a different host', async () => {
    mockHeadersGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        host: 'customer.example.com',
      }
      return values[name] ?? null
    })

    const result = await getCloudAnalyticsResult()
    render(result)

    expect(mockBoundary).not.toHaveBeenCalled()
    expect(result).not.toBeNull()
    const { getAnalyticsConsent } = await import('../consent-store')
    expect(getAnalyticsConsent()).toBe('disabled')
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'disables analytics when deployment edition is %s',
    async (deploymentEdition) => {
      queryClient.setQueryData(systemFeaturesQueryKey, { deployment_edition: deploymentEdition })
      await renderCloudAnalytics()

      expect(mockBoundary).not.toHaveBeenCalled()
    },
  )

  it('suspends analytics without deleting pending registration state when System Features are unavailable', async () => {
    queryClient.removeQueries({ queryKey: systemFeaturesQueryKey })
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'pending-marker')

    const result = await getCloudAnalyticsResult()
    render(result)

    expect(mockBoundary).not.toHaveBeenCalled()
    const { getAnalyticsConsent } = await import('../consent-store')
    expect(getAnalyticsConsent()).toBe('unknown')
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBe('pending-marker')
  })
})
