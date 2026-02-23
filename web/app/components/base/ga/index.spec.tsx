import type { ReactElement, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

type ConfigState = {
  isCeEdition: boolean
  isProd: boolean
}

type GaProps = {
  gaType: string
}

type GaRenderFn = (props: GaProps) => Promise<ReactNode>

const { mockHeaders, mockHeadersGet, configState } = vi.hoisted(() => ({
  mockHeaders: vi.fn(),
  mockHeadersGet: vi.fn(),
  configState: ({
    isCeEdition: false,
    isProd: true,
  }) as ConfigState,
}))

vi.mock('@/config', () => ({
  get IS_CE_EDITION() {
    return configState.isCeEdition
  },
  get IS_PROD() {
    return configState.isProd
  },
}))

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}))

vi.mock('next/script', () => ({
  default: ({
    id,
    strategy,
    src,
    nonce,
    dangerouslySetInnerHTML,
  }: {
    id?: string
    strategy?: string
    src?: string
    nonce?: string
    dangerouslySetInnerHTML?: { __html?: string }
  }) => (
    <script
      data-testid="mock-next-script"
      data-id={id ?? ''}
      data-inline={dangerouslySetInnerHTML?.__html ?? ''}
      data-nonce={nonce ?? ''}
      data-src={src ?? ''}
      data-strategy={strategy ?? ''}
    />
  ),
}))

const loadComponent = async () => {
  const mod = await import('./index')
  const maybeMemoComponent = mod.default as unknown as { type?: GaRenderFn }

  const renderer = typeof maybeMemoComponent === 'function'
    ? (maybeMemoComponent as unknown as GaRenderFn)
    : maybeMemoComponent.type

  if (!renderer)
    throw new Error('GA component is not callable in tests')

  return {
    renderer,
    GaType: mod.GaType,
  }
}

const renderGA = async (gaType: string) => {
  const { renderer } = await loadComponent()
  const element = await renderer({ gaType })
  if (!element)
    return null

  return render(element as ReactElement)
}

describe('GA', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    configState.isCeEdition = false
    configState.isProd = true

    mockHeadersGet.mockReturnValue(`default-src 'self'; script-src 'self' 'nonce-test-nonce'`)
    mockHeaders.mockResolvedValue({
      get: mockHeadersGet,
    })
  })

  describe('Rendering', () => {
    it('should return null when CE edition is enabled', async () => {
      configState.isCeEdition = true
      const { renderer, GaType } = await loadComponent()

      const element = await renderer({ gaType: GaType.admin })

      expect(element).toBeNull()
      expect(mockHeaders).not.toHaveBeenCalled()
    })

    it('should render three script tags with admin GA id in production', async () => {
      const { GaType } = await loadComponent()
      await renderGA(GaType.admin)

      const scripts = screen.getAllByTestId('mock-next-script')
      expect(scripts).toHaveLength(3)

      expect(mockHeaders).toHaveBeenCalledTimes(1)
      expect(mockHeadersGet).toHaveBeenCalledWith('content-security-policy')

      expect(scripts[0]).toHaveAttribute('data-id', 'ga-init')
      expect(scripts[0]).toHaveAttribute('data-strategy', 'afterInteractive')
      expect(scripts[0]).toHaveAttribute('data-inline', expect.stringContaining(`window.gtag('config', 'G-DM9497FN4V');`))

      expect(scripts[1]).toHaveAttribute('data-strategy', 'afterInteractive')
      expect(scripts[1]).toHaveAttribute('data-src', 'https://www.googletagmanager.com/gtag/js?id=G-DM9497FN4V')

      expect(scripts[2]).toHaveAttribute('data-id', 'cookieyes')
      expect(scripts[2]).toHaveAttribute('data-strategy', 'lazyOnload')
      expect(scripts[2]).toHaveAttribute('data-src', 'https://cdn-cookieyes.com/client_data/2a645945fcae53f8e025a2b1/script.js')

      scripts.forEach((script) => {
        expect(script).toHaveAttribute('data-nonce', 'test-nonce')
      })
    })
  })

  describe('Props', () => {
    it('should use webapp GA id when gaType is webapp', async () => {
      const { GaType } = await loadComponent()
      await renderGA(GaType.webapp)

      const scripts = screen.getAllByTestId('mock-next-script')

      expect(scripts[0]).toHaveAttribute('data-inline', expect.stringContaining(`window.gtag('config', 'G-2MFWXK7WYT');`))
      expect(scripts[1]).toHaveAttribute('data-src', 'https://www.googletagmanager.com/gtag/js?id=G-2MFWXK7WYT')
    })
  })

  describe('Edge Cases', () => {
    it('should not read headers and should omit nonce when not in production', async () => {
      configState.isProd = false
      const { GaType } = await loadComponent()
      await renderGA(GaType.admin)

      const scripts = screen.getAllByTestId('mock-next-script')

      expect(mockHeaders).not.toHaveBeenCalled()
      scripts.forEach((script) => {
        expect(script).toHaveAttribute('data-nonce', '')
      })
    })

    it('should omit nonce when CSP header does not contain nonce token', async () => {
      mockHeadersGet.mockReturnValue(`default-src 'self'; script-src 'self'`)
      const { GaType } = await loadComponent()
      await renderGA(GaType.admin)

      const scripts = screen.getAllByTestId('mock-next-script')

      expect(mockHeaders).toHaveBeenCalledTimes(1)
      scripts.forEach((script) => {
        expect(script).toHaveAttribute('data-nonce', '')
      })
    })
  })
})
