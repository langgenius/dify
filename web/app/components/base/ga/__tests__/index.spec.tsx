import type { ReactElement, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

type ConfigState = {
  isCloudEdition: boolean
  isProd: boolean
}

type GoogleAnalyticsScriptsRenderFn = () => Promise<ReactNode>

const { mockHeaders, mockHeadersGet, configState } = vi.hoisted(() => ({
  mockHeaders: vi.fn(),
  mockHeadersGet: vi.fn(),
  configState: {
    isCloudEdition: true,
    isProd: true,
  } as ConfigState,
}))

vi.mock('@/config', () => ({
  get IS_CLOUD_EDITION() {
    return configState.isCloudEdition
  },
  get IS_PROD() {
    return configState.isProd
  },
}))

vi.mock('@/next/headers', () => ({
  headers: mockHeaders,
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
      data-testid="mock-next-script"
      data-id={id ?? ''}
      data-inline={typeof children === 'string' ? children : ''}
      data-nonce={nonce ?? ''}
      data-src={src ?? ''}
      data-strategy={strategy ?? ''}
    />
  ),
}))

const loadComponent = async () => {
  const mod = await import('../index')

  return {
    renderer: mod.GoogleAnalyticsScripts as GoogleAnalyticsScriptsRenderFn,
  }
}

const renderGoogleAnalyticsScripts = async () => {
  const { renderer } = await loadComponent()
  const element = await renderer()
  if (!element) return { element }

  render(element as ReactElement)
  return { element }
}

describe('GA', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    configState.isCloudEdition = true
    configState.isProd = true

    mockHeadersGet.mockImplementation((name: string) => (name === 'x-nonce' ? 'test-nonce' : null))
    mockHeaders.mockResolvedValue({
      get: mockHeadersGet,
    })
  })

  describe('Rendering', () => {
    it('should return null when cloud edition is disabled', async () => {
      configState.isCloudEdition = false
      const { element } = await renderGoogleAnalyticsScripts()

      expect(element).toBeNull()
      expect(mockHeaders).not.toHaveBeenCalled()
    })

    it('should return null when not in production', async () => {
      configState.isProd = false
      const { element } = await renderGoogleAnalyticsScripts()

      expect(element).toBeNull()
      expect(mockHeaders).not.toHaveBeenCalled()
    })

    it('should render consent, CookieYes, and Google Analytics scripts in production', async () => {
      await renderGoogleAnalyticsScripts()

      const scripts = screen.getAllByTestId('mock-next-script')
      expect(scripts).toHaveLength(4)

      expect(mockHeaders).toHaveBeenCalledTimes(1)
      expect(mockHeadersGet).toHaveBeenCalledWith('x-nonce')

      expect(scripts[0]).toHaveAttribute('data-id', 'google-consent-defaults')
      expect(scripts[0]).toHaveAttribute('data-strategy', 'afterInteractive')
      expect(scripts[0]).toHaveAttribute(
        'data-inline',
        expect.stringContaining(`window.gtag('consent', 'default'`),
      )
      expect(scripts[0]).toHaveAttribute(
        'data-inline',
        expect.stringContaining(`analytics_storage: 'denied'`),
      )

      expect(scripts[1]).toHaveAttribute('data-id', 'cookieyes')
      expect(scripts[1]).toHaveAttribute('data-strategy', 'afterInteractive')
      expect(scripts[1]).toHaveAttribute(
        'data-src',
        'https://cdn-cookieyes.com/client_data/2a645945fcae53f8e025a2b1/script.js',
      )

      expect(scripts[2]).toHaveAttribute('data-id', 'google-analytics')
      expect(scripts[2]).toHaveAttribute('data-strategy', 'afterInteractive')
      expect(scripts[2]).toHaveAttribute(
        'data-src',
        'https://www.googletagmanager.com/gtag/js?id=G-DM9497FN4V',
      )

      expect(scripts[3]).toHaveAttribute('data-id', 'google-analytics-init')
      expect(scripts[3]).toHaveAttribute('data-strategy', 'afterInteractive')
      expect(scripts[3]).toHaveAttribute(
        'data-inline',
        expect.stringContaining(`window.gtag('config', 'G-DM9497FN4V');`),
      )

      scripts.forEach((script) => {
        expect(script).toHaveAttribute('data-nonce', 'test-nonce')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should omit nonce when x-nonce header is missing', async () => {
      mockHeadersGet.mockReturnValue(null)
      await renderGoogleAnalyticsScripts()

      const scripts = screen.getAllByTestId('mock-next-script')

      expect(mockHeaders).toHaveBeenCalledTimes(1)
      scripts.forEach((script) => {
        expect(script).toHaveAttribute('data-nonce', '')
      })
    })
  })
})
