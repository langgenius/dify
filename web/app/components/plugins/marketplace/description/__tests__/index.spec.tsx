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

    it('should render "in" preposition at the end for non-Chinese locales', () => {
      render(<Description />)

      expect(screen.getByText('in')).toBeInTheDocument()
    })

    it('should render Dify Marketplace text at the end for non-Chinese locales', () => {
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading.textContent).toContain('Dify Marketplace')
    })

    it('should render category spans with styled underline effect', () => {
      const { container } = render(<Description />)

      const styledSpans = container.querySelectorAll('.body-md-medium.relative.z-1')
      // 7 category spans (models, tools, datasources, triggers, agents, extensions, bundles)
      expect(styledSpans.length).toBe(7)
    })

    it('should apply text-text-secondary class to category spans', () => {
      const { container } = render(<Description />)

      const styledSpans = container.querySelectorAll('.text-text-secondary')
      expect(styledSpans.length).toBeGreaterThanOrEqual(7)
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

  // ================================
  // Locale Variations Tests
  // ================================
  describe('Locale Variations', () => {
    it('should use en-US locale by default', () => {
      mockDefaultLocale = 'en-US'
      render(<Description />)

      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should handle ja-JP locale as non-Chinese', () => {
      mockDefaultLocale = 'ja-JP'
      render(<Description />)

      // Should render in non-Chinese format (discover first, then "in Dify Marketplace" at end)
      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading.textContent).toContain('Dify Marketplace')
    })

    it('should handle ko-KR locale as non-Chinese', () => {
      mockDefaultLocale = 'ko-KR'
      render(<Description />)

      // Should render in non-Chinese format
      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should handle de-DE locale as non-Chinese', () => {
      mockDefaultLocale = 'de-DE'
      render(<Description />)

      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should handle fr-FR locale as non-Chinese', () => {
      mockDefaultLocale = 'fr-FR'
      render(<Description />)

      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should handle pt-BR locale as non-Chinese', () => {
      mockDefaultLocale = 'pt-BR'
      render(<Description />)

      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should handle es-ES locale as non-Chinese', () => {
      mockDefaultLocale = 'es-ES'
      render(<Description />)

      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })
  })

  // ================================
  // Conditional Rendering Tests
  // ================================
  describe('Conditional Rendering', () => {
    it('should render zh-Hans specific content when locale is zh-Hans', () => {
      mockDefaultLocale = 'zh-Hans'
      const { container } = render(<Description />)

      // zh-Hans has additional span with mr-1 before "in" text at the start
      const mrSpan = container.querySelector('span.mr-1')
      expect(mrSpan).toBeInTheDocument()
    })

    it('should render non-Chinese specific content when locale is not zh-Hans', () => {
      mockDefaultLocale = 'en-US'
      render(<Description />)

      // Non-Chinese has "in" and "Dify Marketplace" at the end
      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading.textContent).toContain('Dify Marketplace')
    })

    it('should not render zh-Hans intro content for non-Chinese locales', () => {
      mockDefaultLocale = 'en-US'
      render(<Description />)

      // For en-US, the order should be Discover ... in Dify Marketplace
      // The "in" text should only appear once at the end
      const subheading = screen.getByRole('heading', { level: 2 })
      const content = subheading.textContent || ''

      // "in" should appear after "Bundles" and before "Dify Marketplace"
      const bundlesIndex = content.indexOf('Bundles')
      const inIndex = content.indexOf('in')
      const marketplaceIndex = content.indexOf('Dify Marketplace')

      expect(bundlesIndex).toBeLessThan(inIndex)
      expect(inIndex).toBeLessThan(marketplaceIndex)
    })

    it('should render zh-Hans with proper word order', () => {
      mockDefaultLocale = 'zh-Hans'
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      const content = subheading.textContent || ''

      // zh-Hans order: in -> Dify Marketplace -> Discover -> categories
      const inIndex = content.indexOf('in')
      const marketplaceIndex = content.indexOf('Dify Marketplace')
      const discoverIndex = content.indexOf('Discover')

      expect(inIndex).toBeLessThan(marketplaceIndex)
      expect(marketplaceIndex).toBeLessThan(discoverIndex)
    })
  })

  // ================================
  // Category Styling Tests
  // ================================
  describe('Category Styling', () => {
    it('should apply underline effect with after pseudo-element styling', () => {
      const { container } = render(<Description />)

      const categorySpan = container.querySelector('.after\\:absolute')
      expect(categorySpan).toBeInTheDocument()
    })

    it('should apply correct after pseudo-element classes', () => {
      const { container } = render(<Description />)

      // Check for the specific after pseudo-element classes
      const categorySpans = container.querySelectorAll('.after\\:bottom-\\[1\\.5px\\]')
      expect(categorySpans.length).toBe(7)
    })

    it('should apply full width to after element', () => {
      const { container } = render(<Description />)

      const categorySpans = container.querySelectorAll('.after\\:w-full')
      expect(categorySpans.length).toBe(7)
    })

    it('should apply correct height to after element', () => {
      const { container } = render(<Description />)

      const categorySpans = container.querySelectorAll('.after\\:h-2')
      expect(categorySpans.length).toBe(7)
    })

    it('should apply bg-text-text-selected to after element', () => {
      const { container } = render(<Description />)

      const categorySpans = container.querySelectorAll('.after\\:bg-text-text-selected')
      expect(categorySpans.length).toBe(7)
    })

    it('should have z-index 1 on category spans', () => {
      const { container } = render(<Description />)

      const categorySpans = container.querySelectorAll('.z-1')
      expect(categorySpans.length).toBe(7)
    })

    it('should apply left margin to category spans', () => {
      const { container } = render(<Description />)

      const categorySpans = container.querySelectorAll('.ml-1')
      expect(categorySpans.length).toBeGreaterThanOrEqual(7)
    })

    it('should apply both left and right margin to specific spans', () => {
      const { container } = render(<Description />)

      // Extensions and Bundles spans have both ml-1 and mr-1
      const extensionsBundlesSpans = container.querySelectorAll('.ml-1.mr-1')
      expect(extensionsBundlesSpans.length).toBe(2)
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should render fragment as root element', () => {
      const { container } = render(<Description />)

      // Fragment renders h1 and h2 as direct children
      expect(container.querySelector('h1')).toBeInTheDocument()
      expect(container.querySelector('h2')).toBeInTheDocument()
    })

    it('should handle zh-Hant as non-Chinese simplified', () => {
      mockDefaultLocale = 'zh-Hant'
      render(<Description />)

      // zh-Hant is different from zh-Hans, should use non-Chinese format
      const subheading = screen.getByRole('heading', { level: 2 })
      const content = subheading.textContent || ''

      // Check that "Dify Marketplace" appears at the end (non-Chinese format)
      const discoverIndex = content.indexOf('Discover')
      const marketplaceIndex = content.indexOf('Dify Marketplace')

      // For non-Chinese locales, Discover should come before Dify Marketplace
      expect(discoverIndex).toBeLessThan(marketplaceIndex)
    })
  })

  // ================================
  // Content Structure Tests
  // ================================
  describe('Content Structure', () => {
    it('should have comma separators between categories', () => {
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      const content = subheading.textContent || ''

      // Commas should exist between categories
      expect(content).toMatch(/Models[^\n\r,\u2028\u2029]*,.*Tools[^\n\r,\u2028\u2029]*,.*Data Sources[^\n\r,\u2028\u2029]*,.*Triggers[^\n\r,\u2028\u2029]*,.*Agent Strategies[^\n\r,\u2028\u2029]*,.*Extensions/)
    })

    it('should have "and" before last category (Bundles)', () => {
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      const content = subheading.textContent || ''

      // "and" should appear before Bundles
      const andIndex = content.indexOf('and')
      const bundlesIndex = content.indexOf('Bundles')

      expect(andIndex).toBeLessThan(bundlesIndex)
    })

    it('should render all text elements in correct order for en-US', () => {
      mockDefaultLocale = 'en-US'
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      const content = subheading.textContent || ''

      const expectedOrder = [
        'Discover',
        'Models',
        'Tools',
        'Data Sources',
        'Triggers',
        'Agent Strategies',
        'Extensions',
        'and',
        'Bundles',
        'in',
        'Dify Marketplace',
      ]

      let lastIndex = -1
      for (const text of expectedOrder) {
        const currentIndex = content.indexOf(text)
        expect(currentIndex).toBeGreaterThan(lastIndex)
        lastIndex = currentIndex
      }
    })

    it('should render all text elements in correct order for zh-Hans', () => {
      mockDefaultLocale = 'zh-Hans'
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      const content = subheading.textContent || ''

      // zh-Hans order: in -> Dify Marketplace -> Discover -> categories -> and -> Bundles
      const inIndex = content.indexOf('in')
      const marketplaceIndex = content.indexOf('Dify Marketplace')
      const discoverIndex = content.indexOf('Discover')
      const modelsIndex = content.indexOf('Models')

      expect(inIndex).toBeLessThan(marketplaceIndex)
      expect(marketplaceIndex).toBeLessThan(discoverIndex)
      expect(discoverIndex).toBeLessThan(modelsIndex)
    })
  })

  // ================================
  // Layout Tests
  // ================================
  describe('Layout', () => {
    it('should have shrink-0 on h1 heading', () => {
      render(<Description />)

      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveClass('shrink-0')
    })

    it('should have shrink-0 on h2 subheading', () => {
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toHaveClass('shrink-0')
    })

    it('should have flex layout on h2', () => {
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toHaveClass('flex')
    })

    it('should have items-center on h2', () => {
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toHaveClass('items-center')
    })

    it('should have justify-center on h2', () => {
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toHaveClass('justify-center')
    })
  })

  // ================================
  // Accessibility Tests
  // ================================
  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      render(<Description />)

      const h1 = screen.getByRole('heading', { level: 1 })
      const h2 = screen.getByRole('heading', { level: 2 })

      expect(h1).toBeInTheDocument()
      expect(h2).toBeInTheDocument()
    })

    it('should have readable text content', () => {
      render(<Description />)

      const h1 = screen.getByRole('heading', { level: 1 })
      expect(h1.textContent).not.toBe('')
    })

    it('should have visible h1 heading', () => {
      render(<Description />)

      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeVisible()
    })

    it('should have visible h2 heading', () => {
      render(<Description />)

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toBeVisible()
    })
  })
})
