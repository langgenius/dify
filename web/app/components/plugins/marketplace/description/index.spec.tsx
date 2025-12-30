import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Import component after mocks are set up
import Description from './index'

// ================================
// Mock external dependencies
// ================================

// Track mock locale for testing
let mockDefaultLocale = 'en-US'

// Mock translations with realistic values
const pluginTranslations: Record<string, string> = {
  'marketplace.empower': 'Empower your AI development',
  'marketplace.discover': 'Discover',
  'marketplace.difyMarketplace': 'Dify Marketplace',
  'marketplace.and': 'and',
  'category.models': 'Models',
  'category.tools': 'Tools',
  'category.datasources': 'Data Sources',
  'category.triggers': 'Triggers',
  'category.agents': 'Agent Strategies',
  'category.extensions': 'Extensions',
  'category.bundles': 'Bundles',
}

const commonTranslations: Record<string, string> = {
  'operation.in': 'in',
}

// Mock getLocaleOnServer and translate
vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: vi.fn(() => Promise.resolve(mockDefaultLocale)),
  getTranslation: vi.fn((locale: string, ns: string) => {
    return Promise.resolve({
      t: (key: string) => {
        if (ns === 'plugin')
          return pluginTranslations[key] || key
        if (ns === 'common')
          return commonTranslations[key] || key
        return key
      },
    })
  }),
}))

// ================================
// Description Component Tests
// ================================
describe('Description', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDefaultLocale = 'en-US'
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', async () => {
      const { container } = render(await Description({}))

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render h1 heading with empower text', async () => {
      render(await Description({}))

      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveTextContent('Empower your AI development')
    })

    it('should render h2 subheading', async () => {
      render(await Description({}))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toBeInTheDocument()
    })

    it('should apply correct CSS classes to h1', async () => {
      render(await Description({}))

      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveClass('title-4xl-semi-bold')
      expect(heading).toHaveClass('mb-2')
      expect(heading).toHaveClass('text-center')
      expect(heading).toHaveClass('text-text-primary')
    })

    it('should apply correct CSS classes to h2', async () => {
      render(await Description({}))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toHaveClass('body-md-regular')
      expect(subheading).toHaveClass('text-center')
      expect(subheading).toHaveClass('text-text-tertiary')
    })
  })

  // ================================
  // Non-Chinese Locale Rendering Tests
  // ================================
  describe('Non-Chinese Locale Rendering', () => {
    it('should render discover text for en-US locale', async () => {
      render(await Description({ locale: 'en-US' }))

      expect(screen.getByText(/Discover/)).toBeInTheDocument()
    })

    it('should render all category names', async () => {
      render(await Description({ locale: 'en-US' }))

      expect(screen.getByText('Models')).toBeInTheDocument()
      expect(screen.getByText('Tools')).toBeInTheDocument()
      expect(screen.getByText('Data Sources')).toBeInTheDocument()
      expect(screen.getByText('Triggers')).toBeInTheDocument()
      expect(screen.getByText('Agent Strategies')).toBeInTheDocument()
      expect(screen.getByText('Extensions')).toBeInTheDocument()
      expect(screen.getByText('Bundles')).toBeInTheDocument()
    })

    it('should render "and" conjunction text', async () => {
      render(await Description({ locale: 'en-US' }))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading.textContent).toContain('and')
    })

    it('should render "in" preposition at the end for non-Chinese locales', async () => {
      render(await Description({ locale: 'en-US' }))

      expect(screen.getByText('in')).toBeInTheDocument()
    })

    it('should render Dify Marketplace text at the end for non-Chinese locales', async () => {
      render(await Description({ locale: 'en-US' }))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading.textContent).toContain('Dify Marketplace')
    })

    it('should render category spans with styled underline effect', async () => {
      const { container } = render(await Description({ locale: 'en-US' }))

      const styledSpans = container.querySelectorAll('.body-md-medium.relative.z-\\[1\\]')
      // 7 category spans (models, tools, datasources, triggers, agents, extensions, bundles)
      expect(styledSpans.length).toBe(7)
    })

    it('should apply text-text-secondary class to category spans', async () => {
      const { container } = render(await Description({ locale: 'en-US' }))

      const styledSpans = container.querySelectorAll('.text-text-secondary')
      expect(styledSpans.length).toBeGreaterThanOrEqual(7)
    })
  })

  // ================================
  // Chinese (zh-Hans) Locale Rendering Tests
  // ================================
  describe('Chinese (zh-Hans) Locale Rendering', () => {
    it('should render "in" text at the beginning for zh-Hans locale', async () => {
      render(await Description({ locale: 'zh-Hans' }))

      // In zh-Hans mode, "in" appears at the beginning
      const inElements = screen.getAllByText('in')
      expect(inElements.length).toBeGreaterThanOrEqual(1)
    })

    it('should render Dify Marketplace text for zh-Hans locale', async () => {
      render(await Description({ locale: 'zh-Hans' }))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading.textContent).toContain('Dify Marketplace')
    })

    it('should render discover text for zh-Hans locale', async () => {
      render(await Description({ locale: 'zh-Hans' }))

      expect(screen.getByText(/Discover/)).toBeInTheDocument()
    })

    it('should render all categories for zh-Hans locale', async () => {
      render(await Description({ locale: 'zh-Hans' }))

      expect(screen.getByText('Models')).toBeInTheDocument()
      expect(screen.getByText('Tools')).toBeInTheDocument()
      expect(screen.getByText('Data Sources')).toBeInTheDocument()
      expect(screen.getByText('Triggers')).toBeInTheDocument()
      expect(screen.getByText('Agent Strategies')).toBeInTheDocument()
      expect(screen.getByText('Extensions')).toBeInTheDocument()
      expect(screen.getByText('Bundles')).toBeInTheDocument()
    })

    it('should render both zh-Hans specific elements and shared elements', async () => {
      render(await Description({ locale: 'zh-Hans' }))

      // zh-Hans has specific element order: "in" -> Dify Marketplace -> Discover
      // then the same category list with "and" -> Bundles
      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading.textContent).toContain('and')
    })
  })

  // ================================
  // Locale Prop Variations Tests
  // ================================
  describe('Locale Prop Variations', () => {
    it('should use default locale when locale prop is undefined', async () => {
      mockDefaultLocale = 'en-US'
      render(await Description({}))

      // Should use the default locale from getLocaleOnServer
      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should use provided locale prop instead of default', async () => {
      mockDefaultLocale = 'ja-JP'
      render(await Description({ locale: 'en-US' }))

      // The locale prop should be used, triggering non-Chinese rendering
      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toBeInTheDocument()
    })

    it('should handle ja-JP locale as non-Chinese', async () => {
      render(await Description({ locale: 'ja-JP' }))

      // Should render in non-Chinese format (discover first, then "in Dify Marketplace" at end)
      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading.textContent).toContain('Dify Marketplace')
    })

    it('should handle ko-KR locale as non-Chinese', async () => {
      render(await Description({ locale: 'ko-KR' }))

      // Should render in non-Chinese format
      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should handle de-DE locale as non-Chinese', async () => {
      render(await Description({ locale: 'de-DE' }))

      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should handle fr-FR locale as non-Chinese', async () => {
      render(await Description({ locale: 'fr-FR' }))

      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should handle pt-BR locale as non-Chinese', async () => {
      render(await Description({ locale: 'pt-BR' }))

      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })

    it('should handle es-ES locale as non-Chinese', async () => {
      render(await Description({ locale: 'es-ES' }))

      expect(screen.getByText('Empower your AI development')).toBeInTheDocument()
    })
  })

  // ================================
  // Conditional Rendering Tests
  // ================================
  describe('Conditional Rendering', () => {
    it('should render zh-Hans specific content when locale is zh-Hans', async () => {
      const { container } = render(await Description({ locale: 'zh-Hans' }))

      // zh-Hans has additional span with mr-1 before "in" text at the start
      const mrSpan = container.querySelector('span.mr-1')
      expect(mrSpan).toBeInTheDocument()
    })

    it('should render non-Chinese specific content when locale is not zh-Hans', async () => {
      render(await Description({ locale: 'en-US' }))

      // Non-Chinese has "in" and "Dify Marketplace" at the end
      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading.textContent).toContain('Dify Marketplace')
    })

    it('should not render zh-Hans intro content for non-Chinese locales', async () => {
      render(await Description({ locale: 'en-US' }))

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

    it('should render zh-Hans with proper word order', async () => {
      render(await Description({ locale: 'zh-Hans' }))

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
    it('should apply underline effect with after pseudo-element styling', async () => {
      const { container } = render(await Description({}))

      const categorySpan = container.querySelector('.after\\:absolute')
      expect(categorySpan).toBeInTheDocument()
    })

    it('should apply correct after pseudo-element classes', async () => {
      const { container } = render(await Description({}))

      // Check for the specific after pseudo-element classes
      const categorySpans = container.querySelectorAll('.after\\:bottom-\\[1\\.5px\\]')
      expect(categorySpans.length).toBe(7)
    })

    it('should apply full width to after element', async () => {
      const { container } = render(await Description({}))

      const categorySpans = container.querySelectorAll('.after\\:w-full')
      expect(categorySpans.length).toBe(7)
    })

    it('should apply correct height to after element', async () => {
      const { container } = render(await Description({}))

      const categorySpans = container.querySelectorAll('.after\\:h-2')
      expect(categorySpans.length).toBe(7)
    })

    it('should apply bg-text-text-selected to after element', async () => {
      const { container } = render(await Description({}))

      const categorySpans = container.querySelectorAll('.after\\:bg-text-text-selected')
      expect(categorySpans.length).toBe(7)
    })

    it('should have z-index 1 on category spans', async () => {
      const { container } = render(await Description({}))

      const categorySpans = container.querySelectorAll('.z-\\[1\\]')
      expect(categorySpans.length).toBe(7)
    })

    it('should apply left margin to category spans', async () => {
      const { container } = render(await Description({}))

      const categorySpans = container.querySelectorAll('.ml-1')
      expect(categorySpans.length).toBeGreaterThanOrEqual(7)
    })

    it('should apply both left and right margin to specific spans', async () => {
      const { container } = render(await Description({}))

      // Extensions and Bundles spans have both ml-1 and mr-1
      const extensionsBundlesSpans = container.querySelectorAll('.ml-1.mr-1')
      expect(extensionsBundlesSpans.length).toBe(2)
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty props object', async () => {
      const { container } = render(await Description({}))

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render fragment as root element', async () => {
      const { container } = render(await Description({}))

      // Fragment renders h1 and h2 as direct children
      expect(container.querySelector('h1')).toBeInTheDocument()
      expect(container.querySelector('h2')).toBeInTheDocument()
    })

    it('should handle locale prop with undefined value', async () => {
      render(await Description({ locale: undefined }))

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    })

    it('should handle zh-Hant as non-Chinese simplified', async () => {
      render(await Description({ locale: 'zh-Hant' }))

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
    it('should have comma separators between categories', async () => {
      render(await Description({}))

      const subheading = screen.getByRole('heading', { level: 2 })
      const content = subheading.textContent || ''

      // Commas should exist between categories
      expect(content).toMatch(/Models[^\n\r,\u2028\u2029]*,.*Tools[^\n\r,\u2028\u2029]*,.*Data Sources[^\n\r,\u2028\u2029]*,.*Triggers[^\n\r,\u2028\u2029]*,.*Agent Strategies[^\n\r,\u2028\u2029]*,.*Extensions/)
    })

    it('should have "and" before last category (Bundles)', async () => {
      render(await Description({}))

      const subheading = screen.getByRole('heading', { level: 2 })
      const content = subheading.textContent || ''

      // "and" should appear before Bundles
      const andIndex = content.indexOf('and')
      const bundlesIndex = content.indexOf('Bundles')

      expect(andIndex).toBeLessThan(bundlesIndex)
    })

    it('should render all text elements in correct order for en-US', async () => {
      render(await Description({ locale: 'en-US' }))

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

    it('should render all text elements in correct order for zh-Hans', async () => {
      render(await Description({ locale: 'zh-Hans' }))

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
    it('should have shrink-0 on h1 heading', async () => {
      render(await Description({}))

      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveClass('shrink-0')
    })

    it('should have shrink-0 on h2 subheading', async () => {
      render(await Description({}))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toHaveClass('shrink-0')
    })

    it('should have flex layout on h2', async () => {
      render(await Description({}))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toHaveClass('flex')
    })

    it('should have items-center on h2', async () => {
      render(await Description({}))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toHaveClass('items-center')
    })

    it('should have justify-center on h2', async () => {
      render(await Description({}))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toHaveClass('justify-center')
    })
  })

  // ================================
  // Translation Function Tests
  // ================================
  describe('Translation Functions', () => {
    it('should call getTranslation for plugin namespace', async () => {
      const { getTranslation } = await import('@/i18n-config/server')
      render(await Description({ locale: 'en-US' }))

      expect(getTranslation).toHaveBeenCalledWith('en-US', 'plugin')
    })

    it('should call getTranslation for common namespace', async () => {
      const { getTranslation } = await import('@/i18n-config/server')
      render(await Description({ locale: 'en-US' }))

      expect(getTranslation).toHaveBeenCalledWith('en-US', 'common')
    })

    it('should call getLocaleOnServer when locale prop is undefined', async () => {
      const { getLocaleOnServer } = await import('@/i18n-config/server')
      render(await Description({}))

      expect(getLocaleOnServer).toHaveBeenCalled()
    })

    it('should use locale prop when provided', async () => {
      const { getTranslation } = await import('@/i18n-config/server')
      render(await Description({ locale: 'ja-JP' }))

      expect(getTranslation).toHaveBeenCalledWith('ja-JP', 'plugin')
      expect(getTranslation).toHaveBeenCalledWith('ja-JP', 'common')
    })
  })

  // ================================
  // Accessibility Tests
  // ================================
  describe('Accessibility', () => {
    it('should have proper heading hierarchy', async () => {
      render(await Description({}))

      const h1 = screen.getByRole('heading', { level: 1 })
      const h2 = screen.getByRole('heading', { level: 2 })

      expect(h1).toBeInTheDocument()
      expect(h2).toBeInTheDocument()
    })

    it('should have readable text content', async () => {
      render(await Description({}))

      const h1 = screen.getByRole('heading', { level: 1 })
      expect(h1.textContent).not.toBe('')
    })

    it('should have visible h1 heading', async () => {
      render(await Description({}))

      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeVisible()
    })

    it('should have visible h2 heading', async () => {
      render(await Description({}))

      const subheading = screen.getByRole('heading', { level: 2 })
      expect(subheading).toBeVisible()
    })
  })
})

// ================================
// Integration Tests
// ================================
describe('Description Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDefaultLocale = 'en-US'
  })

  it('should render complete component structure', async () => {
    const { container } = render(await Description({ locale: 'en-US' }))

    // Main headings
    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(container.querySelector('h2')).toBeInTheDocument()

    // All category spans
    const categorySpans = container.querySelectorAll('.body-md-medium')
    expect(categorySpans.length).toBe(7)
  })

  it('should render complete zh-Hans structure', async () => {
    const { container } = render(await Description({ locale: 'zh-Hans' }))

    // Main headings
    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(container.querySelector('h2')).toBeInTheDocument()

    // All category spans
    const categorySpans = container.querySelectorAll('.body-md-medium')
    expect(categorySpans.length).toBe(7)
  })

  it('should correctly switch between zh-Hans and en-US layouts', async () => {
    // Render en-US
    const { container: enContainer, unmount: unmountEn } = render(await Description({ locale: 'en-US' }))
    const enContent = enContainer.querySelector('h2')?.textContent || ''
    unmountEn()

    // Render zh-Hans
    const { container: zhContainer } = render(await Description({ locale: 'zh-Hans' }))
    const zhContent = zhContainer.querySelector('h2')?.textContent || ''

    // Both should have all categories
    expect(enContent).toContain('Models')
    expect(zhContent).toContain('Models')

    // But order should differ
    const enMarketplaceIndex = enContent.indexOf('Dify Marketplace')
    const enDiscoverIndex = enContent.indexOf('Discover')
    const zhMarketplaceIndex = zhContent.indexOf('Dify Marketplace')
    const zhDiscoverIndex = zhContent.indexOf('Discover')

    // en-US: Discover comes before Dify Marketplace
    expect(enDiscoverIndex).toBeLessThan(enMarketplaceIndex)

    // zh-Hans: Dify Marketplace comes before Discover
    expect(zhMarketplaceIndex).toBeLessThan(zhDiscoverIndex)
  })

  it('should maintain consistent styling across locales', async () => {
    // Render en-US
    const { container: enContainer, unmount: unmountEn } = render(await Description({ locale: 'en-US' }))
    const enCategoryCount = enContainer.querySelectorAll('.body-md-medium').length
    unmountEn()

    // Render zh-Hans
    const { container: zhContainer } = render(await Description({ locale: 'zh-Hans' }))
    const zhCategoryCount = zhContainer.querySelectorAll('.body-md-medium').length

    // Both should have same number of styled category spans
    expect(enCategoryCount).toBe(zhCategoryCount)
    expect(enCategoryCount).toBe(7)
  })
})
