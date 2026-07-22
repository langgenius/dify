import type { ReactNode } from 'react'
import { render } from '@testing-library/react'

type ConfigState = {
  cookieYesSiteKey: string
  isCloudEdition: boolean
  isProd: boolean
  webPrefix: string | undefined
}

const { configState, mockHeadersGet } = vi.hoisted(() => ({
  configState: {
    cookieYesSiteKey: 'site-key',
    isCloudEdition: true,
    isProd: true,
    webPrefix: 'https://cloud.dify.ai',
  } as ConfigState,
  mockHeadersGet: vi.fn(),
}))

vi.mock('@/config', () => ({
  get COOKIEYES_SITE_KEY() {
    return configState.cookieYesSiteKey
  },
  get IS_CLOUD_EDITION() {
    return configState.isCloudEdition
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

async function renderBoundary() {
  const [{ CloudAnalyticsBoundary }, { getCloudAnalyticsBoundaryState }] = await Promise.all([
    import('../cloud-analytics-boundary'),
    import('../cloud-analytics-state'),
  ])
  const state = getCloudAnalyticsBoundaryState({ get: mockHeadersGet })
  const view = render(<CloudAnalyticsBoundary {...state} />)
  return { ...view, state }
}

describe('CloudAnalyticsBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    configState.cookieYesSiteKey = 'site-key'
    configState.isCloudEdition = true
    configState.isProd = true
    configState.webPrefix = 'https://cloud.dify.ai'
    mockHeadersGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        host: 'cloud.dify.ai',
        'x-dify-pathname': '/signin',
        'x-nonce': 'test-nonce',
      }
      return values[name] ?? null
    })
  })

  it('renders a directly detectable CookieYes script in the head sequence', async () => {
    const { container, state } = await renderBoundary()
    const scripts = Array.from(container.querySelectorAll('script'))
    const scriptIds = scripts.map(
      (script) => script.getAttribute('id') || script.getAttribute('data-id'),
    )

    expect(state.enabled).toBe(true)
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
  })

  it('does not render on a published-app path', async () => {
    mockHeadersGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        host: 'cloud.dify.ai',
        'x-dify-pathname': '/chat/token',
      }
      return values[name] ?? null
    })

    const { container, state } = await renderBoundary()

    expect(state.enabled).toBe(false)
    expect(container.querySelector('script')).toBeNull()
  })

  it('does not render on a different host', async () => {
    mockHeadersGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        host: 'customer.example.com',
        'x-dify-pathname': '/signin',
      }
      return values[name] ?? null
    })

    const { container, state } = await renderBoundary()

    expect(state.enabled).toBe(false)
    expect(container.querySelector('script')).toBeNull()
  })
})
