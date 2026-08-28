import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'

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
  getCachedSystemFeatures: () => queryClient.getQueryData(systemFeaturesQueryKey),
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

async function renderCloudAnalytics() {
  const { CloudAnalytics } = await import('../cloud-analytics')
  return render(await CloudAnalytics())
}

describe('CloudAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    configState.cookieYesSiteKey = 'site-key'
    configState.isProd = true
    configState.webPrefix = 'https://cloud.dify.ai'
    queryClient = new QueryClient()
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

    const { queryByTestId } = await renderCloudAnalytics()

    expect(queryByTestId('cloud-analytics-layout-boundary')).toBeNull()
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'disables analytics when deployment edition is %s',
    async (deploymentEdition) => {
      queryClient.setQueryData(systemFeaturesQueryKey, { deployment_edition: deploymentEdition })
      const { queryByTestId } = await renderCloudAnalytics()

      expect(queryByTestId('cloud-analytics-layout-boundary')).toBeNull()
    },
  )

  it('does not render when System Features are unavailable', async () => {
    queryClient.removeQueries({ queryKey: systemFeaturesQueryKey })

    const { queryByTestId } = await renderCloudAnalytics()

    expect(queryByTestId('cloud-analytics-layout-boundary')).toBeNull()
  })
})
