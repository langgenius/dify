import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Description } from '../index'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'marketplace.pluginsHeroTitle': 'Build with plugins',
        'marketplace.pluginsHeroSubtitle': 'Discover and install marketplace plugins.',
        'marketplace.templatesHeroTitle': 'Build with templates',
        'marketplace.templatesHeroSubtitle': 'Explore reusable templates.',
      }
      return translations[key] || key
    },
  }),
}))

let mockCreationType = 'plugins'

vi.mock('../../atoms', () => ({
  useCreationType: () => mockCreationType,
}))

vi.mock('../../search-params', () => ({
  CREATION_TYPE: {
    plugins: 'plugins',
    templates: 'templates',
  },
}))

vi.mock('../../category-switch', () => ({
  PluginCategorySwitch: ({ variant }: { variant?: string }) => <div data-testid="plugin-category-switch">{variant}</div>,
  TemplateCategorySwitch: ({ variant }: { variant?: string }) => <div data-testid="template-category-switch">{variant}</div>,
}))

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
  useMotionValue: (value: number) => ({ set: vi.fn(), get: () => value }),
  useSpring: (value: unknown) => value,
  useTransform: (...args: unknown[]) => {
    const values = args[0]
    if (Array.isArray(values))
      return 0
    return values
  },
}))

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

describe('Description', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreationType = 'plugins'
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  describe('Rendering', () => {
    it('should render plugin hero content by default', () => {
      render(<Description />)

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Build with plugins')
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Discover and install marketplace plugins.')
      expect(screen.getByTestId('plugin-category-switch')).toHaveTextContent('hero')
    })

    it('should render template hero content when creationType is templates', () => {
      mockCreationType = 'templates'

      render(<Description />)

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Build with templates')
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Explore reusable templates.')
      expect(screen.getByTestId('template-category-switch')).toHaveTextContent('hero')
    })
  })

  describe('Props', () => {
    it('should render marketplace nav content when provided', () => {
      render(<Description marketplaceNav={<div data-testid="marketplace-nav">Nav</div>} />)

      expect(screen.getByTestId('marketplace-nav')).toBeInTheDocument()
    })

    it('should apply custom className to the sticky wrapper', () => {
      const { container } = render(<Description className="custom-hero-class" />)

      expect(container.querySelector('.custom-hero-class')).toBeInTheDocument()
    })
  })
})
