import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { REGISTRATION_SUCCESS_STORAGE_KEY } from '@/app/components/base/amplitude/registration-session-state'

let queryClient: QueryClient

type ConfigState = {
  cookieYesSiteKey: string
  isProd: boolean
  webPrefix: string | undefined
}

const { configState, mockHeadersGet, systemFeaturesQueryKey } = vi.hoisted(() => ({
  configState: {
    cookieYesSiteKey: 'site-key',
    isProd: true,
    webPrefix: 'https://cloud.dify.ai',
  } as ConfigState,
  mockHeadersGet: vi.fn(),
  systemFeaturesQueryKey: ['console', 'system-features'] as const,
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
  CloudAnalyticsLayoutBoundary: ({
    cookieYesSiteKey,
    nonce,
  }: {
    cookieYesSiteKey: string
    nonce?: string
  }) => (
    <span
      data-cookieyes-site-key={cookieYesSiteKey}
      data-nonce={nonce}
      data-testid="cloud-analytics-layout-boundary"
    />
  ),
}))

async function getCloudAnalyticsResult() {
  const { CloudAnalytics } = await import('../cloud-analytics')
  return CloudAnalytics()
}

async function renderCloudAnalytics() {
  return render(await getCloudAnalyticsResult())
}

describe('CloudAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    configState.cookieYesSiteKey = 'site-key'
    configState.isProd = true
    configState.webPrefix = 'https://cloud.dify.ai'
    queryClient = new QueryClient()
    window.sessionStorage.clear()
    queryClient.setQueryData(systemFeaturesQueryKey, { deployment_edition: 'CLOUD' })
    mockHeadersGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        host: 'cloud.dify.ai',
        'x-nonce': 'test-nonce',
      }
      return values[name] ?? null
    })
  })

  it('mounts the layout boundary for an eligible Cloud request', async () => {
    const { getByTestId } = await renderCloudAnalytics()
    const boundary = getByTestId('cloud-analytics-layout-boundary')

    expect(boundary).toHaveAttribute('data-cookieyes-site-key', 'site-key')
    expect(boundary).toHaveAttribute('data-nonce', 'test-nonce')
  })

  it('does not render on a different host', async () => {
    mockHeadersGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        host: 'customer.example.com',
      }
      return values[name] ?? null
    })

    const result = await getCloudAnalyticsResult()
    const { queryByTestId } = render(result)

    expect(queryByTestId('cloud-analytics-layout-boundary')).toBeNull()
    expect(result).not.toBeNull()
    const { getAnalyticsConsent } = await import('../consent-store')
    expect(getAnalyticsConsent()).toBe('disabled')
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'disables analytics when deployment edition is %s',
    async (deploymentEdition) => {
      queryClient.setQueryData(systemFeaturesQueryKey, { deployment_edition: deploymentEdition })
      const { queryByTestId } = await renderCloudAnalytics()

      expect(queryByTestId('cloud-analytics-layout-boundary')).toBeNull()
    },
  )

  it('suspends analytics without deleting pending registration state when System Features are unavailable', async () => {
    queryClient.removeQueries({ queryKey: systemFeaturesQueryKey })
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'pending-marker')

    const result = await getCloudAnalyticsResult()
    const { queryByTestId } = render(result)

    expect(queryByTestId('cloud-analytics-layout-boundary')).toBeNull()
    const { getAnalyticsConsent } = await import('../consent-store')
    expect(getAnalyticsConsent()).toBe('unknown')
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBe('pending-marker')
  })
})
