import type { ReactNode } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'

let queryClient: QueryClient

type ConfigState = {
  cookieYesSiteKey: string
  isProd: boolean
  webPrefix: string | undefined
}

const { configState, getSystemFeatures, mockHeadersGet, systemFeaturesQueryKey } = vi.hoisted(
  () => ({
    configState: {
      cookieYesSiteKey: 'site-key',
      isProd: true,
      webPrefix: 'https://cloud.dify.ai',
    } as ConfigState,
    getSystemFeatures: vi.fn(),
    mockHeadersGet: vi.fn(),
    systemFeaturesQueryKey: ['console', 'system-features'] as const,
  }),
)

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => queryClient,
}))

vi.mock('@/features/system-features/server', () => ({
  serverSystemFeaturesQueryOptions: () => ({
    queryFn: getSystemFeatures,
    queryKey: systemFeaturesQueryKey,
  }),
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

vi.mock('@/next/script', () => ({
  default: ({
    id,
    strategy,
    src,
    nonce,
    children,
  }: {
    id?: string
    strategy?: string
    src?: string
    nonce?: string
    children?: ReactNode
  }) => (
    <script
      data-id={id ?? ''}
      data-inline={typeof children === 'string' ? children : ''}
      data-nonce={nonce ?? ''}
      data-src={src ?? ''}
      data-strategy={strategy ?? ''}
    />
  ),
}))

vi.mock('@/next/headers', () => ({
  headers: async () => ({ get: mockHeadersGet }),
}))

vi.mock('../cloud-analytics-runtime', () => ({
  CloudAnalyticsRuntime: () => <span data-testid="cloud-analytics-runtime" />,
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
        'x-dify-pathname': '/signin',
        'x-nonce': 'test-nonce',
      }
      return values[name] ?? null
    })
  })

  it('renders analytics scripts before interaction and mounts the runtime', async () => {
    const { container, getByTestId } = await renderCloudAnalytics()
    const scripts = Array.from(container.querySelectorAll('script'))
    const scriptIds = scripts.map(
      (script) => script.getAttribute('id') || script.getAttribute('data-id'),
    )

    expect(scriptIds).toEqual([
      'google-consent-defaults',
      'cookieyes',
      'google-analytics',
      'google-analytics-init',
    ])

    const consentDefaultsScript = container.querySelector(
      'script[data-id="google-consent-defaults"]',
    )
    expect(consentDefaultsScript).toHaveAttribute('data-strategy', 'beforeInteractive')

    const cookieYesScript = container.querySelector('script[data-id="cookieyes"]')
    expect(cookieYesScript).toHaveAttribute(
      'data-src',
      'https://cdn-cookieyes.com/client_data/site-key/script.js',
    )
    expect(cookieYesScript).toHaveAttribute('data-strategy', 'beforeInteractive')
    expect(cookieYesScript).toHaveAttribute('data-nonce', 'test-nonce')
    expect(getByTestId('cloud-analytics-runtime')).toBeInTheDocument()
  })

  it('does not render on a published-app path', async () => {
    mockHeadersGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        host: 'cloud.dify.ai',
        'x-dify-pathname': '/chat/token',
      }
      return values[name] ?? null
    })

    const { container, queryByTestId } = await renderCloudAnalytics()

    expect(container.querySelector('script')).toBeNull()
    expect(queryByTestId('cloud-analytics-runtime')).toBeNull()
  })

  it('does not render on a different host', async () => {
    mockHeadersGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        host: 'customer.example.com',
        'x-dify-pathname': '/signin',
      }
      return values[name] ?? null
    })

    const { container, queryByTestId } = await renderCloudAnalytics()

    expect(container.querySelector('script')).toBeNull()
    expect(queryByTestId('cloud-analytics-runtime')).toBeNull()
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'disables analytics when deployment edition is %s',
    async (deploymentEdition) => {
      queryClient.setQueryData(systemFeaturesQueryKey, { deployment_edition: deploymentEdition })
      const { container, queryByTestId } = await renderCloudAnalytics()

      expect(container.querySelector('script')).toBeNull()
      expect(queryByTestId('cloud-analytics-runtime')).toBeNull()
    },
  )

  it('does not render when System Features are unavailable', async () => {
    queryClient.removeQueries({ queryKey: systemFeaturesQueryKey })

    const { container, queryByTestId } = await renderCloudAnalytics()

    expect(container.querySelector('script')).toBeNull()
    expect(queryByTestId('cloud-analytics-runtime')).toBeNull()
    expect(getSystemFeatures).not.toHaveBeenCalled()
  })
})
