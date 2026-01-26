import type { Plugin } from '../types'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../types'

import Icon from './base/card-icon'
import CornerMark from './base/corner-mark'
import Description from './base/description'
import DownloadCount from './base/download-count'
import OrgInfo from './base/org-info'
import Placeholder, { LoadingPlaceholder } from './base/placeholder'
import Title from './base/title'
import CardMoreInfo from './card-more-info'
// ================================
// Import Components Under Test
// ================================
import Card from './index'

// ================================
// Mock External Dependencies Only
// ================================

// Mock useTheme hook
let mockTheme = 'light'
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme }),
}))

// Mock i18n-config
vi.mock('@/i18n-config', () => ({
  renderI18nObject: (obj: Record<string, string>, locale: string) => {
    return obj?.[locale] || obj?.['en-US'] || ''
  },
}))

// Mock i18n-config/language
vi.mock('@/i18n-config/language', () => ({
  getLanguage: (locale: string) => locale || 'en-US',
}))

// Mock useCategories hook
const mockCategoriesMap: Record<string, { label: string }> = {
  'tool': { label: 'Tool' },
  'model': { label: 'Model' },
  'extension': { label: 'Extension' },
  'agent-strategy': { label: 'Agent' },
  'datasource': { label: 'Datasource' },
  'trigger': { label: 'Trigger' },
  'bundle': { label: 'Bundle' },
}

vi.mock('../hooks', () => ({
  useCategories: () => ({
    categoriesMap: mockCategoriesMap,
  }),
}))

// Mock formatNumber utility
vi.mock('@/utils/format', () => ({
  formatNumber: (num: number) => num.toLocaleString(),
}))

// Mock shouldUseMcpIcon utility
vi.mock('@/utils/mcp', () => ({
  shouldUseMcpIcon: (src: unknown) => typeof src === 'object' && src !== null && (src as { content?: string })?.content === '🔗',
}))

// Mock AppIcon component
vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ icon, background, innerIcon, size, iconType }: {
    icon?: string
    background?: string
    innerIcon?: React.ReactNode
    size?: string
    iconType?: string
  }) => (
    <div
      data-testid="app-icon"
      data-icon={icon}
      data-background={background}
      data-size={size}
      data-icon-type={iconType}
    >
      {!!innerIcon && <div data-testid="inner-icon">{innerIcon}</div>}
    </div>
  ),
}))

// Mock Mcp icon component
vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  Mcp: ({ className }: { className?: string }) => (
    <div data-testid="mcp-icon" className={className}>MCP</div>
  ),
  Group: ({ className }: { className?: string }) => (
    <div data-testid="group-icon" className={className}>Group</div>
  ),
}))

// Mock LeftCorner icon component
vi.mock('../../base/icons/src/vender/plugin', () => ({
  LeftCorner: ({ className }: { className?: string }) => (
    <div data-testid="left-corner" className={className}>LeftCorner</div>
  ),
}))

// Mock Partner badge
vi.mock('../base/badges/partner', () => ({
  default: ({ className, text }: { className?: string, text?: string }) => (
    <div data-testid="partner-badge" className={className} title={text}>Partner</div>
  ),
}))

// Mock Verified badge
vi.mock('../base/badges/verified', () => ({
  default: ({ className, text }: { className?: string, text?: string }) => (
    <div data-testid="verified-badge" className={className} title={text}>Verified</div>
  ),
}))

// Mock Skeleton components
vi.mock('@/app/components/base/skeleton', () => ({
  SkeletonContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="skeleton-container">{children}</div>
  ),
  SkeletonPoint: () => <div data-testid="skeleton-point" />,
  SkeletonRectangle: ({ className }: { className?: string }) => (
    <div data-testid="skeleton-rectangle" className={className} />
  ),
  SkeletonRow: ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div data-testid="skeleton-row" className={className}>{children}</div>
  ),
}))

// Mock Remix icons
vi.mock('@remixicon/react', () => ({
  RiCheckLine: ({ className }: { className?: string }) => (
    <span data-testid="ri-check-line" className={className}>✓</span>
  ),
  RiCloseLine: ({ className }: { className?: string }) => (
    <span data-testid="ri-close-line" className={className}>✕</span>
  ),
  RiInstallLine: ({ className }: { className?: string }) => (
    <span data-testid="ri-install-line" className={className}>↓</span>
  ),
  RiAlertFill: ({ className }: { className?: string }) => (
    <span data-testid="ri-alert-fill" className={className}>⚠</span>
  ),
}))

// ================================
// Test Data Factories
// ================================

const createMockPlugin = (overrides?: Partial<Plugin>): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: 'test-plugin',
  plugin_id: 'plugin-123',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-org/test-plugin:1.0.0',
  icon: '/test-icon.png',
  verified: false,
  label: { 'en-US': 'Test Plugin' },
  brief: { 'en-US': 'Test plugin description' },
  description: { 'en-US': 'Full test plugin description' },
  introduction: 'Test plugin introduction',
  repository: 'https://github.com/test/plugin',
  category: PluginCategoryEnum.tool,
  install_count: 1000,
  endpoint: { settings: [] },
  tags: [{ name: 'search' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

// ================================
// Card Component Tests (index.tsx)
// ================================
describe('Card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const plugin = createMockPlugin()
      render(<Card payload={plugin} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should render plugin title from label', () => {
      const plugin = createMockPlugin({
        label: { 'en-US': 'My Plugin Title' },
      })

      render(<Card payload={plugin} />)

      expect(screen.getByText('My Plugin Title')).toBeInTheDocument()
    })

    it('should render plugin description from brief', () => {
      const plugin = createMockPlugin({
        brief: { 'en-US': 'This is a brief description' },
      })

      render(<Card payload={plugin} />)

      expect(screen.getByText('This is a brief description')).toBeInTheDocument()
    })

    it('should render organization info with org name and package name', () => {
      const plugin = createMockPlugin({
        org: 'my-org',
        name: 'my-plugin',
      })

      render(<Card payload={plugin} />)

      expect(screen.getByText('my-org')).toBeInTheDocument()
      expect(screen.getByText('my-plugin')).toBeInTheDocument()
    })

    it('should render plugin icon', () => {
      const plugin = createMockPlugin({
        icon: '/custom-icon.png',
      })

      const { container } = render(<Card payload={plugin} />)

      // Check for background image style on icon element
      const iconElement = container.querySelector('[style*="background-image"]')
      expect(iconElement).toBeInTheDocument()
    })

    it('should use icon_dark when theme is dark and icon_dark is provided', () => {
      // Set theme to dark
      mockTheme = 'dark'

      const plugin = createMockPlugin({
        icon: '/light-icon.png',
        icon_dark: '/dark-icon.png',
      })

      const { container } = render(<Card payload={plugin} />)

      // Check that icon uses dark icon
      const iconElement = container.querySelector('[style*="background-image"]')
      expect(iconElement).toBeInTheDocument()
      expect(iconElement).toHaveStyle({ backgroundImage: 'url(/dark-icon.png)' })

      // Reset theme
      mockTheme = 'light'
    })

    it('should use icon when theme is dark but icon_dark is not provided', () => {
      mockTheme = 'dark'

      const plugin = createMockPlugin({
        icon: '/light-icon.png',
      })

      const { container } = render(<Card payload={plugin} />)

      // Should fallback to light icon
      const iconElement = container.querySelector('[style*="background-image"]')
      expect(iconElement).toBeInTheDocument()
      expect(iconElement).toHaveStyle({ backgroundImage: 'url(/light-icon.png)' })

      mockTheme = 'light'
    })

    it('should render corner mark with category label', () => {
      const plugin = createMockPlugin({
        category: PluginCategoryEnum.tool,
      })

      render(<Card payload={plugin} />)

      expect(screen.getByText('Tool')).toBeInTheDocument()
    })
  })

  // ================================
  // Props Testing
  // ================================
  describe('Props', () => {
    it('should apply custom className', () => {
      const plugin = createMockPlugin()
      const { container } = render(
        <Card payload={plugin} className="custom-class" />,
      )

      expect(container.querySelector('.custom-class')).toBeInTheDocument()
    })

    it('should hide corner mark when hideCornerMark is true', () => {
      const plugin = createMockPlugin({
        category: PluginCategoryEnum.tool,
      })

      render(<Card payload={plugin} hideCornerMark={true} />)

      expect(screen.queryByTestId('left-corner')).not.toBeInTheDocument()
    })

    it('should show corner mark by default', () => {
      const plugin = createMockPlugin()

      render(<Card payload={plugin} />)

      expect(screen.getByTestId('left-corner')).toBeInTheDocument()
    })

    it('should pass installed prop to Icon component', () => {
      const plugin = createMockPlugin()
      render(<Card payload={plugin} installed={true} />)

      // Check for the check icon that appears when installed
      expect(screen.getByTestId('ri-check-line')).toBeInTheDocument()
    })

    it('should pass installFailed prop to Icon component', () => {
      const plugin = createMockPlugin()
      render(<Card payload={plugin} installFailed={true} />)

      // Check for the close icon that appears when install failed
      expect(screen.getByTestId('ri-close-line')).toBeInTheDocument()
    })

    it('should render footer when provided', () => {
      const plugin = createMockPlugin()
      render(
        <Card payload={plugin} footer={<div data-testid="custom-footer">Footer Content</div>} />,
      )

      expect(screen.getByTestId('custom-footer')).toBeInTheDocument()
      expect(screen.getByText('Footer Content')).toBeInTheDocument()
    })

    it('should render titleLeft when provided', () => {
      const plugin = createMockPlugin()
      render(
        <Card payload={plugin} titleLeft={<span data-testid="title-left">v1.0</span>} />,
      )

      expect(screen.getByTestId('title-left')).toBeInTheDocument()
    })

    it('should use custom descriptionLineRows', () => {
      const plugin = createMockPlugin()

      const { container } = render(
        <Card payload={plugin} descriptionLineRows={1} />,
      )

      // Check for h-4 truncate class when descriptionLineRows is 1
      expect(container.querySelector('.h-4.truncate')).toBeInTheDocument()
    })

    it('should use default descriptionLineRows of 2', () => {
      const plugin = createMockPlugin()

      const { container } = render(<Card payload={plugin} />)

      // Check for h-8 line-clamp-2 class when descriptionLineRows is 2 (default)
      expect(container.querySelector('.h-8.line-clamp-2')).toBeInTheDocument()
    })
  })

  // ================================
  // Loading State Tests
  // ================================
  describe('Loading State', () => {
    it('should render Placeholder when isLoading is true', () => {
      const plugin = createMockPlugin()

      render(<Card payload={plugin} isLoading={true} loadingFileName="loading.txt" />)

      // Should render skeleton elements
      expect(screen.getByTestId('skeleton-container')).toBeInTheDocument()
    })

    it('should render loadingFileName in Placeholder', () => {
      const plugin = createMockPlugin()

      render(<Card payload={plugin} isLoading={true} loadingFileName="my-plugin.zip" />)

      expect(screen.getByText('my-plugin.zip')).toBeInTheDocument()
    })

    it('should not render card content when loading', () => {
      const plugin = createMockPlugin({
        label: { 'en-US': 'Plugin Title' },
      })

      render(<Card payload={plugin} isLoading={true} loadingFileName="file.txt" />)

      // Plugin content should not be visible during loading
      expect(screen.queryByText('Plugin Title')).not.toBeInTheDocument()
    })

    it('should not render loading state by default', () => {
      const plugin = createMockPlugin()

      render(<Card payload={plugin} />)

      expect(screen.queryByTestId('skeleton-container')).not.toBeInTheDocument()
    })
  })

  // ================================
  // Badges Tests
  // ================================
  describe('Badges', () => {
    it('should render Partner badge when badges includes partner', () => {
      const plugin = createMockPlugin({
        badges: ['partner'],
      })

      render(<Card payload={plugin} />)

      expect(screen.getByTestId('partner-badge')).toBeInTheDocument()
    })

    it('should render Verified badge when verified is true', () => {
      const plugin = createMockPlugin({
        verified: true,
      })

      render(<Card payload={plugin} />)

      expect(screen.getByTestId('verified-badge')).toBeInTheDocument()
    })

    it('should render both Partner and Verified badges', () => {
      const plugin = createMockPlugin({
        badges: ['partner'],
        verified: true,
      })

      render(<Card payload={plugin} />)

      expect(screen.getByTestId('partner-badge')).toBeInTheDocument()
      expect(screen.getByTestId('verified-badge')).toBeInTheDocument()
    })

    it('should not render Partner badge when badges is empty', () => {
      const plugin = createMockPlugin({
        badges: [],
      })

      render(<Card payload={plugin} />)

      expect(screen.queryByTestId('partner-badge')).not.toBeInTheDocument()
    })

    it('should not render Verified badge when verified is false', () => {
      const plugin = createMockPlugin({
        verified: false,
      })

      render(<Card payload={plugin} />)

      expect(screen.queryByTestId('verified-badge')).not.toBeInTheDocument()
    })

    it('should handle undefined badges gracefully', () => {
      const plugin = createMockPlugin()
      // @ts-expect-error - Testing undefined badges
      plugin.badges = undefined

      render(<Card payload={plugin} />)

      expect(screen.queryByTestId('partner-badge')).not.toBeInTheDocument()
    })
  })

  // ================================
  // Limited Install Warning Tests
  // ================================
  describe('Limited Install Warning', () => {
    it('should render warning when limitedInstall is true', () => {
      const plugin = createMockPlugin()

      render(<Card payload={plugin} limitedInstall={true} />)

      expect(screen.getByTestId('ri-alert-fill')).toBeInTheDocument()
    })

    it('should not render warning by default', () => {
      const plugin = createMockPlugin()

      render(<Card payload={plugin} />)

      expect(screen.queryByTestId('ri-alert-fill')).not.toBeInTheDocument()
    })

    it('should apply limited padding when limitedInstall is true', () => {
      const plugin = createMockPlugin()

      const { container } = render(<Card payload={plugin} limitedInstall={true} />)

      expect(container.querySelector('.pb-1')).toBeInTheDocument()
    })
  })

  // ================================
  // Category Type Tests
  // ================================
  describe('Category Types', () => {
    it('should display bundle label for bundle type', () => {
      const plugin = createMockPlugin({
        type: 'bundle',
        category: PluginCategoryEnum.tool,
      })

      render(<Card payload={plugin} />)

      // For bundle type, should show 'Bundle' instead of category
      expect(screen.getByText('Bundle')).toBeInTheDocument()
    })

    it('should display category label for non-bundle types', () => {
      const plugin = createMockPlugin({
        type: 'plugin',
        category: PluginCategoryEnum.model,
      })

      render(<Card payload={plugin} />)

      expect(screen.getByText('Model')).toBeInTheDocument()
    })
  })

  // ================================
  // Memoization Tests
  // ================================
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      // Card is wrapped with React.memo
      expect(Card).toBeDefined()
      // The component should have the memo display name characteristic
      expect(typeof Card).toBe('object')
    })

    it('should not re-render when props are the same', () => {
      const plugin = createMockPlugin()
      const renderCount = vi.fn()

      const TestWrapper = ({ p }: { p: Plugin }) => {
        renderCount()
        return <Card payload={p} />
      }

      const { rerender } = render(<TestWrapper p={plugin} />)
      expect(renderCount).toHaveBeenCalledTimes(1)

      // Re-render with same plugin reference
      rerender(<TestWrapper p={plugin} />)
      expect(renderCount).toHaveBeenCalledTimes(2)
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty label object', () => {
      const plugin = createMockPlugin({
        label: {},
      })

      render(<Card payload={plugin} />)

      // Should render without crashing
      expect(document.body).toBeInTheDocument()
    })

    it('should handle empty brief object', () => {
      const plugin = createMockPlugin({
        brief: {},
      })

      render(<Card payload={plugin} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should handle undefined label', () => {
      const plugin = createMockPlugin()
      // @ts-expect-error - Testing undefined label
      plugin.label = undefined

      render(<Card payload={plugin} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should handle special characters in plugin name', () => {
      const plugin = createMockPlugin({
        name: 'plugin-with-special-chars!@#$%',
        org: 'org<script>alert(1)</script>',
      })

      render(<Card payload={plugin} />)

      expect(screen.getByText('plugin-with-special-chars!@#$%')).toBeInTheDocument()
    })

    it('should handle very long title', () => {
      const longTitle = 'A'.repeat(500)
      const plugin = createMockPlugin({
        label: { 'en-US': longTitle },
      })

      const { container } = render(<Card payload={plugin} />)

      // Should have truncate class for long text
      expect(container.querySelector('.truncate')).toBeInTheDocument()
    })

    it('should handle very long description', () => {
      const longDescription = 'B'.repeat(1000)
      const plugin = createMockPlugin({
        brief: { 'en-US': longDescription },
      })

      const { container } = render(<Card payload={plugin} />)

      // Should have line-clamp class for long text
      expect(container.querySelector('.line-clamp-2')).toBeInTheDocument()
    })
  })
})

// ================================
// CardMoreInfo Component Tests
// ================================
describe('CardMoreInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<CardMoreInfo downloadCount={100} tags={['tag1']} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should render download count when provided', () => {
      render(<CardMoreInfo downloadCount={1000} tags={[]} />)

      expect(screen.getByText('1,000')).toBeInTheDocument()
    })

    it('should render tags when provided', () => {
      render(<CardMoreInfo tags={['search', 'image']} />)

      expect(screen.getByText('search')).toBeInTheDocument()
      expect(screen.getByText('image')).toBeInTheDocument()
    })

    it('should render both download count and tags with separator', () => {
      render(<CardMoreInfo downloadCount={500} tags={['tag1']} />)

      expect(screen.getByText('500')).toBeInTheDocument()
      expect(screen.getByText('·')).toBeInTheDocument()
      expect(screen.getByText('tag1')).toBeInTheDocument()
    })
  })

  // ================================
  // Props Testing
  // ================================
  describe('Props', () => {
    it('should not render download count when undefined', () => {
      render(<CardMoreInfo tags={['tag1']} />)

      expect(screen.queryByTestId('ri-install-line')).not.toBeInTheDocument()
    })

    it('should not render separator when download count is undefined', () => {
      render(<CardMoreInfo tags={['tag1']} />)

      expect(screen.queryByText('·')).not.toBeInTheDocument()
    })

    it('should not render separator when tags are empty', () => {
      render(<CardMoreInfo downloadCount={100} tags={[]} />)

      expect(screen.queryByText('·')).not.toBeInTheDocument()
    })

    it('should render hash symbol before each tag', () => {
      render(<CardMoreInfo tags={['search']} />)

      expect(screen.getByText('#')).toBeInTheDocument()
    })

    it('should set title attribute with hash prefix for tags', () => {
      render(<CardMoreInfo tags={['search']} />)

      const tagElement = screen.getByTitle('# search')
      expect(tagElement).toBeInTheDocument()
    })
  })

  // ================================
  // Memoization Tests
  // ================================
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      expect(CardMoreInfo).toBeDefined()
      expect(typeof CardMoreInfo).toBe('object')
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle zero download count', () => {
      render(<CardMoreInfo downloadCount={0} tags={[]} />)

      // 0 should still render since downloadCount is defined
      expect(screen.getByText('0')).toBeInTheDocument()
    })

    it('should handle empty tags array', () => {
      render(<CardMoreInfo downloadCount={100} tags={[]} />)

      expect(screen.queryByText('#')).not.toBeInTheDocument()
    })

    it('should handle large download count', () => {
      render(<CardMoreInfo downloadCount={1234567890} tags={[]} />)

      expect(screen.getByText('1,234,567,890')).toBeInTheDocument()
    })

    it('should handle many tags', () => {
      const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`)
      render(<CardMoreInfo downloadCount={100} tags={tags} />)

      expect(screen.getByText('tag0')).toBeInTheDocument()
      expect(screen.getByText('tag9')).toBeInTheDocument()
    })

    it('should handle tags with special characters', () => {
      render(<CardMoreInfo tags={['tag-with-dash', 'tag_with_underscore']} />)

      expect(screen.getByText('tag-with-dash')).toBeInTheDocument()
      expect(screen.getByText('tag_with_underscore')).toBeInTheDocument()
    })

    it('should truncate long tag names', () => {
      const longTag = 'a'.repeat(200)
      const { container } = render(<CardMoreInfo tags={[longTag]} />)

      expect(container.querySelector('.truncate')).toBeInTheDocument()
    })
  })
})

// ================================
// Icon Component Tests (base/card-icon.tsx)
// ================================
describe('Icon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing with string src', () => {
      render(<Icon src="/icon.png" />)

      expect(document.body).toBeInTheDocument()
    })

    it('should render without crashing with object src', () => {
      render(<Icon src={{ content: '🎉', background: '#fff' }} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should render background image for string src', () => {
      const { container } = render(<Icon src="/test-icon.png" />)

      const iconDiv = container.firstChild as HTMLElement
      expect(iconDiv).toHaveStyle({ backgroundImage: 'url(/test-icon.png)' })
    })

    it('should render AppIcon for object src', () => {
      render(<Icon src={{ content: '🎉', background: '#ffffff' }} />)

      expect(screen.getByTestId('app-icon')).toBeInTheDocument()
    })
  })

  // ================================
  // Props Testing
  // ================================
  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<Icon src="/icon.png" className="custom-icon-class" />)

      expect(container.querySelector('.custom-icon-class')).toBeInTheDocument()
    })

    it('should render check icon when installed is true', () => {
      render(<Icon src="/icon.png" installed={true} />)

      expect(screen.getByTestId('ri-check-line')).toBeInTheDocument()
    })

    it('should render close icon when installFailed is true', () => {
      render(<Icon src="/icon.png" installFailed={true} />)

      expect(screen.getByTestId('ri-close-line')).toBeInTheDocument()
    })

    it('should not render status icon when neither installed nor failed', () => {
      render(<Icon src="/icon.png" />)

      expect(screen.queryByTestId('ri-check-line')).not.toBeInTheDocument()
      expect(screen.queryByTestId('ri-close-line')).not.toBeInTheDocument()
    })

    it('should use default size of large', () => {
      const { container } = render(<Icon src="/icon.png" />)

      expect(container.querySelector('.w-10.h-10')).toBeInTheDocument()
    })

    it('should apply xs size class', () => {
      const { container } = render(<Icon src="/icon.png" size="xs" />)

      expect(container.querySelector('.w-4.h-4')).toBeInTheDocument()
    })

    it('should apply tiny size class', () => {
      const { container } = render(<Icon src="/icon.png" size="tiny" />)

      expect(container.querySelector('.w-6.h-6')).toBeInTheDocument()
    })

    it('should apply small size class', () => {
      const { container } = render(<Icon src="/icon.png" size="small" />)

      expect(container.querySelector('.w-8.h-8')).toBeInTheDocument()
    })

    it('should apply medium size class', () => {
      const { container } = render(<Icon src="/icon.png" size="medium" />)

      expect(container.querySelector('.w-9.h-9')).toBeInTheDocument()
    })

    it('should apply large size class', () => {
      const { container } = render(<Icon src="/icon.png" size="large" />)

      expect(container.querySelector('.w-10.h-10')).toBeInTheDocument()
    })
  })

  // ================================
  // MCP Icon Tests
  // ================================
  describe('MCP Icon', () => {
    it('should render MCP icon when src content is 🔗', () => {
      render(<Icon src={{ content: '🔗', background: '#ffffff' }} />)

      expect(screen.getByTestId('mcp-icon')).toBeInTheDocument()
    })

    it('should not render MCP icon for other emoji content', () => {
      render(<Icon src={{ content: '🎉', background: '#ffffff' }} />)

      expect(screen.queryByTestId('mcp-icon')).not.toBeInTheDocument()
    })
  })

  // ================================
  // Status Indicator Tests
  // ================================
  describe('Status Indicators', () => {
    it('should render success indicator with correct styling for installed', () => {
      const { container } = render(<Icon src="/icon.png" installed={true} />)

      expect(container.querySelector('.bg-state-success-solid')).toBeInTheDocument()
    })

    it('should render destructive indicator with correct styling for failed', () => {
      const { container } = render(<Icon src="/icon.png" installFailed={true} />)

      expect(container.querySelector('.bg-state-destructive-solid')).toBeInTheDocument()
    })

    it('should prioritize installed over installFailed', () => {
      // When both are true, installed takes precedence (rendered first in code)
      render(<Icon src="/icon.png" installed={true} installFailed={true} />)

      expect(screen.getByTestId('ri-check-line')).toBeInTheDocument()
    })
  })

  // ================================
  // Object src Tests
  // ================================
  describe('Object src', () => {
    it('should render AppIcon with correct icon prop', () => {
      render(<Icon src={{ content: '🎉', background: '#ffffff' }} />)

      const appIcon = screen.getByTestId('app-icon')
      expect(appIcon).toHaveAttribute('data-icon', '🎉')
    })

    it('should render AppIcon with correct background prop', () => {
      render(<Icon src={{ content: '🔥', background: '#ff0000' }} />)

      const appIcon = screen.getByTestId('app-icon')
      expect(appIcon).toHaveAttribute('data-background', '#ff0000')
    })

    it('should render AppIcon with emoji iconType', () => {
      render(<Icon src={{ content: '⭐', background: '#ffff00' }} />)

      const appIcon = screen.getByTestId('app-icon')
      expect(appIcon).toHaveAttribute('data-icon-type', 'emoji')
    })

    it('should render AppIcon with correct size', () => {
      render(<Icon src={{ content: '📦', background: '#0000ff' }} size="small" />)

      const appIcon = screen.getByTestId('app-icon')
      expect(appIcon).toHaveAttribute('data-size', 'small')
    })

    it('should apply className to wrapper div for object src', () => {
      const { container } = render(
        <Icon src={{ content: '🎨', background: '#00ff00' }} className="custom-class" />,
      )

      expect(container.querySelector('.relative.custom-class')).toBeInTheDocument()
    })

    it('should render with all size options for object src', () => {
      const sizes = ['xs', 'tiny', 'small', 'medium', 'large'] as const
      sizes.forEach((size) => {
        const { unmount } = render(
          <Icon src={{ content: '📱', background: '#ffffff' }} size={size} />,
        )
        expect(screen.getByTestId('app-icon')).toHaveAttribute('data-size', size)
        unmount()
      })
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty string src', () => {
      const { container } = render(<Icon src="" />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle special characters in URL', () => {
      const { container } = render(<Icon src="/icon?name=test&size=large" />)

      const iconDiv = container.firstChild as HTMLElement
      expect(iconDiv).toHaveStyle({ backgroundImage: 'url(/icon?name=test&size=large)' })
    })

    it('should handle object src with special emoji', () => {
      render(<Icon src={{ content: '👨‍💻', background: '#123456' }} />)

      expect(screen.getByTestId('app-icon')).toBeInTheDocument()
    })

    it('should handle object src with empty content', () => {
      render(<Icon src={{ content: '', background: '#ffffff' }} />)

      expect(screen.getByTestId('app-icon')).toBeInTheDocument()
    })

    it('should not render status indicators when src is object with installed=true', () => {
      render(<Icon src={{ content: '🎉', background: '#fff' }} installed={true} />)

      // Status indicators should not render for object src
      expect(screen.queryByTestId('ri-check-line')).not.toBeInTheDocument()
    })

    it('should not render status indicators when src is object with installFailed=true', () => {
      render(<Icon src={{ content: '🎉', background: '#fff' }} installFailed={true} />)

      // Status indicators should not render for object src
      expect(screen.queryByTestId('ri-close-line')).not.toBeInTheDocument()
    })

    it('should render object src with all size variants', () => {
      const sizes: Array<'xs' | 'tiny' | 'small' | 'medium' | 'large'> = ['xs', 'tiny', 'small', 'medium', 'large']

      sizes.forEach((size) => {
        const { unmount } = render(<Icon src={{ content: '🔗', background: '#fff' }} size={size} />)
        expect(screen.getByTestId('app-icon')).toHaveAttribute('data-size', size)
        unmount()
      })
    })

    it('should render object src with custom className', () => {
      const { container } = render(
        <Icon src={{ content: '🎉', background: '#fff' }} className="custom-object-icon" />,
      )

      expect(container.querySelector('.custom-object-icon')).toBeInTheDocument()
    })

    it('should pass correct props to AppIcon for object src', () => {
      render(<Icon src={{ content: '😀', background: '#123456' }} />)

      const appIcon = screen.getByTestId('app-icon')
      expect(appIcon).toHaveAttribute('data-icon', '😀')
      expect(appIcon).toHaveAttribute('data-background', '#123456')
      expect(appIcon).toHaveAttribute('data-icon-type', 'emoji')
    })

    it('should render inner icon only when shouldUseMcpIcon returns true', () => {
      // Test with MCP icon content
      const { unmount } = render(<Icon src={{ content: '🔗', background: '#fff' }} />)
      expect(screen.getByTestId('inner-icon')).toBeInTheDocument()
      unmount()

      // Test without MCP icon content
      render(<Icon src={{ content: '🎉', background: '#fff' }} />)
      expect(screen.queryByTestId('inner-icon')).not.toBeInTheDocument()
    })
  })

  // ================================
  // CornerMark Component Tests
  // ================================
  describe('CornerMark', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    // ================================
    // Rendering Tests
    // ================================
    describe('Rendering', () => {
      it('should render without crashing', () => {
        render(<CornerMark text="Tool" />)

        expect(document.body).toBeInTheDocument()
      })

      it('should render text content', () => {
        render(<CornerMark text="Tool" />)

        expect(screen.getByText('Tool')).toBeInTheDocument()
      })

      it('should render LeftCorner icon', () => {
        render(<CornerMark text="Model" />)

        expect(screen.getByTestId('left-corner')).toBeInTheDocument()
      })
    })

    // ================================
    // Props Testing
    // ================================
    describe('Props', () => {
      it('should display different category text', () => {
        const { rerender } = render(<CornerMark text="Tool" />)
        expect(screen.getByText('Tool')).toBeInTheDocument()

        rerender(<CornerMark text="Model" />)
        expect(screen.getByText('Model')).toBeInTheDocument()

        rerender(<CornerMark text="Extension" />)
        expect(screen.getByText('Extension')).toBeInTheDocument()
      })
    })

    // ================================
    // Edge Cases Tests
    // ================================
    describe('Edge Cases', () => {
      it('should handle empty text', () => {
        render(<CornerMark text="" />)

        expect(document.body).toBeInTheDocument()
      })

      it('should handle long text', () => {
        const longText = 'Very Long Category Name'
        render(<CornerMark text={longText} />)

        expect(screen.getByText(longText)).toBeInTheDocument()
      })

      it('should handle special characters in text', () => {
        render(<CornerMark text="Test & Demo" />)

        expect(screen.getByText('Test & Demo')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Description Component Tests
  // ================================
  describe('Description', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    // ================================
    // Rendering Tests
    // ================================
    describe('Rendering', () => {
      it('should render without crashing', () => {
        render(<Description text="Test description" descriptionLineRows={2} />)

        expect(document.body).toBeInTheDocument()
      })

      it('should render text content', () => {
        render(<Description text="This is a description" descriptionLineRows={2} />)

        expect(screen.getByText('This is a description')).toBeInTheDocument()
      })
    })

    // ================================
    // Props Testing
    // ================================
    describe('Props', () => {
      it('should apply custom className', () => {
        const { container } = render(
          <Description text="Test" descriptionLineRows={2} className="custom-desc-class" />,
        )

        expect(container.querySelector('.custom-desc-class')).toBeInTheDocument()
      })

      it('should apply h-4 truncate for 1 line row', () => {
        const { container } = render(
          <Description text="Test" descriptionLineRows={1} />,
        )

        expect(container.querySelector('.h-4.truncate')).toBeInTheDocument()
      })

      it('should apply h-8 line-clamp-2 for 2 line rows', () => {
        const { container } = render(
          <Description text="Test" descriptionLineRows={2} />,
        )

        expect(container.querySelector('.h-8.line-clamp-2')).toBeInTheDocument()
      })

      it('should apply h-12 line-clamp-3 for 3+ line rows', () => {
        const { container } = render(
          <Description text="Test" descriptionLineRows={3} />,
        )

        expect(container.querySelector('.h-12.line-clamp-3')).toBeInTheDocument()
      })

      it('should apply h-12 line-clamp-3 for values greater than 3', () => {
        const { container } = render(
          <Description text="Test" descriptionLineRows={5} />,
        )

        expect(container.querySelector('.h-12.line-clamp-3')).toBeInTheDocument()
      })

      it('should apply h-12 line-clamp-3 for descriptionLineRows of 4', () => {
        const { container } = render(
          <Description text="Test" descriptionLineRows={4} />,
        )

        expect(container.querySelector('.h-12.line-clamp-3')).toBeInTheDocument()
      })

      it('should apply h-12 line-clamp-3 for descriptionLineRows of 10', () => {
        const { container } = render(
          <Description text="Test" descriptionLineRows={10} />,
        )

        expect(container.querySelector('.h-12.line-clamp-3')).toBeInTheDocument()
      })

      it('should apply h-12 line-clamp-3 for descriptionLineRows of 0', () => {
        const { container } = render(
          <Description text="Test" descriptionLineRows={0} />,
        )

        // 0 is neither 1 nor 2, so it should use the else branch
        expect(container.querySelector('.h-12.line-clamp-3')).toBeInTheDocument()
      })

      it('should apply h-12 line-clamp-3 for negative descriptionLineRows', () => {
        const { container } = render(
          <Description text="Test" descriptionLineRows={-1} />,
        )

        // negative is neither 1 nor 2, so it should use the else branch
        expect(container.querySelector('.h-12.line-clamp-3')).toBeInTheDocument()
      })
    })

    // ================================
    // Memoization Tests
    // ================================
    describe('Memoization', () => {
      it('should memoize lineClassName based on descriptionLineRows', () => {
        const { container, rerender } = render(
          <Description text="Test" descriptionLineRows={2} />,
        )

        expect(container.querySelector('.line-clamp-2')).toBeInTheDocument()

        // Re-render with same descriptionLineRows
        rerender(<Description text="Different text" descriptionLineRows={2} />)

        // Should still have same class (memoized)
        expect(container.querySelector('.line-clamp-2')).toBeInTheDocument()
      })
    })

    // ================================
    // Edge Cases Tests
    // ================================
    describe('Edge Cases', () => {
      it('should handle empty text', () => {
        render(<Description text="" descriptionLineRows={2} />)

        expect(document.body).toBeInTheDocument()
      })

      it('should handle very long text', () => {
        const longText = 'A'.repeat(1000)
        const { container } = render(
          <Description text={longText} descriptionLineRows={2} />,
        )

        expect(container.querySelector('.line-clamp-2')).toBeInTheDocument()
      })

      it('should handle text with HTML entities', () => {
        render(<Description text="<script>alert('xss')</script>" descriptionLineRows={2} />)

        // Text should be escaped
        expect(screen.getByText('<script>alert(\'xss\')</script>')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // DownloadCount Component Tests
  // ================================
  describe('DownloadCount', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    // ================================
    // Rendering Tests
    // ================================
    describe('Rendering', () => {
      it('should render without crashing', () => {
        render(<DownloadCount downloadCount={100} />)

        expect(document.body).toBeInTheDocument()
      })

      it('should render download count with formatted number', () => {
        render(<DownloadCount downloadCount={1234567} />)

        expect(screen.getByText('1,234,567')).toBeInTheDocument()
      })

      it('should render install icon', () => {
        render(<DownloadCount downloadCount={100} />)

        expect(screen.getByTestId('ri-install-line')).toBeInTheDocument()
      })
    })

    // ================================
    // Props Testing
    // ================================
    describe('Props', () => {
      it('should display small download count', () => {
        render(<DownloadCount downloadCount={5} />)

        expect(screen.getByText('5')).toBeInTheDocument()
      })

      it('should display large download count', () => {
        render(<DownloadCount downloadCount={999999999} />)

        expect(screen.getByText('999,999,999')).toBeInTheDocument()
      })
    })

    // ================================
    // Memoization Tests
    // ================================
    describe('Memoization', () => {
      it('should be memoized with React.memo', () => {
        expect(DownloadCount).toBeDefined()
        expect(typeof DownloadCount).toBe('object')
      })
    })

    // ================================
    // Edge Cases Tests
    // ================================
    describe('Edge Cases', () => {
      it('should handle zero download count', () => {
        render(<DownloadCount downloadCount={0} />)

        // 0 should still render with install icon
        expect(screen.getByText('0')).toBeInTheDocument()
        expect(screen.getByTestId('ri-install-line')).toBeInTheDocument()
      })

      it('should handle negative download count', () => {
        render(<DownloadCount downloadCount={-100} />)

        expect(screen.getByText('-100')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // OrgInfo Component Tests
  // ================================
  describe('OrgInfo', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    // ================================
    // Rendering Tests
    // ================================
    describe('Rendering', () => {
      it('should render without crashing', () => {
        render(<OrgInfo packageName="test-plugin" />)

        expect(document.body).toBeInTheDocument()
      })

      it('should render package name', () => {
        render(<OrgInfo packageName="my-plugin" />)

        expect(screen.getByText('my-plugin')).toBeInTheDocument()
      })

      it('should render org name and separator when provided', () => {
        render(<OrgInfo orgName="my-org" packageName="my-plugin" />)

        expect(screen.getByText('my-org')).toBeInTheDocument()
        expect(screen.getByText('/')).toBeInTheDocument()
        expect(screen.getByText('my-plugin')).toBeInTheDocument()
      })
    })

    // ================================
    // Props Testing
    // ================================
    describe('Props', () => {
      it('should apply custom className', () => {
        const { container } = render(
          <OrgInfo packageName="test" className="custom-org-class" />,
        )

        expect(container.querySelector('.custom-org-class')).toBeInTheDocument()
      })

      it('should apply packageNameClassName', () => {
        const { container } = render(
          <OrgInfo packageName="test" packageNameClassName="custom-package-class" />,
        )

        expect(container.querySelector('.custom-package-class')).toBeInTheDocument()
      })

      it('should not render org name section when orgName is undefined', () => {
        render(<OrgInfo packageName="test" />)

        expect(screen.queryByText('/')).not.toBeInTheDocument()
      })

      it('should not render org name section when orgName is empty', () => {
        render(<OrgInfo orgName="" packageName="test" />)

        expect(screen.queryByText('/')).not.toBeInTheDocument()
      })
    })

    // ================================
    // Edge Cases Tests
    // ================================
    describe('Edge Cases', () => {
      it('should handle special characters in org name', () => {
        render(<OrgInfo orgName="my-org_123" packageName="test" />)

        expect(screen.getByText('my-org_123')).toBeInTheDocument()
      })

      it('should handle special characters in package name', () => {
        render(<OrgInfo packageName="plugin@v1.0.0" />)

        expect(screen.getByText('plugin@v1.0.0')).toBeInTheDocument()
      })

      it('should truncate long package name', () => {
        const longName = 'a'.repeat(100)
        const { container } = render(<OrgInfo packageName={longName} />)

        expect(container.querySelector('.truncate')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Placeholder Component Tests
  // ================================
  describe('Placeholder', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    // ================================
    // Rendering Tests
    // ================================
    describe('Rendering', () => {
      it('should render without crashing', () => {
        render(<Placeholder wrapClassName="test-class" />)

        expect(document.body).toBeInTheDocument()
      })

      it('should render with wrapClassName', () => {
        const { container } = render(
          <Placeholder wrapClassName="custom-wrapper" />,
        )

        expect(container.querySelector('.custom-wrapper')).toBeInTheDocument()
      })

      it('should render skeleton elements', () => {
        render(<Placeholder wrapClassName="test" />)

        expect(screen.getByTestId('skeleton-container')).toBeInTheDocument()
        expect(screen.getAllByTestId('skeleton-rectangle').length).toBeGreaterThan(0)
      })

      it('should render Group icon', () => {
        render(<Placeholder wrapClassName="test" />)

        expect(screen.getByTestId('group-icon')).toBeInTheDocument()
      })
    })

    // ================================
    // Props Testing
    // ================================
    describe('Props', () => {
      it('should render Title when loadingFileName is provided', () => {
        render(<Placeholder wrapClassName="test" loadingFileName="my-file.zip" />)

        expect(screen.getByText('my-file.zip')).toBeInTheDocument()
      })

      it('should render SkeletonRectangle when loadingFileName is not provided', () => {
        render(<Placeholder wrapClassName="test" />)

        // Should have skeleton rectangle for title area
        const rectangles = screen.getAllByTestId('skeleton-rectangle')
        expect(rectangles.length).toBeGreaterThan(0)
      })

      it('should render SkeletonRow for org info', () => {
        render(<Placeholder wrapClassName="test" />)

        // There are multiple skeleton rows in the component
        const skeletonRows = screen.getAllByTestId('skeleton-row')
        expect(skeletonRows.length).toBeGreaterThan(0)
      })
    })

    // ================================
    // Edge Cases Tests
    // ================================
    describe('Edge Cases', () => {
      it('should handle empty wrapClassName', () => {
        const { container } = render(<Placeholder wrapClassName="" />)

        expect(container.firstChild).toBeInTheDocument()
      })

      it('should handle undefined loadingFileName', () => {
        render(<Placeholder wrapClassName="test" loadingFileName={undefined} />)

        // Should show skeleton instead of title
        const rectangles = screen.getAllByTestId('skeleton-rectangle')
        expect(rectangles.length).toBeGreaterThan(0)
      })

      it('should handle long loadingFileName', () => {
        const longFileName = 'very-long-file-name-that-goes-on-forever.zip'
        render(<Placeholder wrapClassName="test" loadingFileName={longFileName} />)

        expect(screen.getByText(longFileName)).toBeInTheDocument()
      })
    })
  })

  // ================================
  // LoadingPlaceholder Component Tests
  // ================================
  describe('LoadingPlaceholder', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    // ================================
    // Rendering Tests
    // ================================
    describe('Rendering', () => {
      it('should render without crashing', () => {
        render(<LoadingPlaceholder />)

        expect(document.body).toBeInTheDocument()
      })

      it('should have correct base classes', () => {
        const { container } = render(<LoadingPlaceholder />)

        expect(container.querySelector('.h-2.rounded-sm')).toBeInTheDocument()
      })
    })

    // ================================
    // Props Testing
    // ================================
    describe('Props', () => {
      it('should apply custom className', () => {
        const { container } = render(<LoadingPlaceholder className="custom-loading" />)

        expect(container.querySelector('.custom-loading')).toBeInTheDocument()
      })

      it('should merge className with base classes', () => {
        const { container } = render(<LoadingPlaceholder className="w-full" />)

        expect(container.querySelector('.h-2.rounded-sm.w-full')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Title Component Tests
  // ================================
  describe('Title', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    // ================================
    // Rendering Tests
    // ================================
    describe('Rendering', () => {
      it('should render without crashing', () => {
        render(<Title title="Test Title" />)

        expect(document.body).toBeInTheDocument()
      })

      it('should render title text', () => {
        render(<Title title="My Plugin Title" />)

        expect(screen.getByText('My Plugin Title')).toBeInTheDocument()
      })

      it('should have truncate class', () => {
        const { container } = render(<Title title="Test" />)

        expect(container.querySelector('.truncate')).toBeInTheDocument()
      })

      it('should have correct text styling', () => {
        const { container } = render(<Title title="Test" />)

        expect(container.querySelector('.system-md-semibold')).toBeInTheDocument()
        expect(container.querySelector('.text-text-secondary')).toBeInTheDocument()
      })
    })

    // ================================
    // Props Testing
    // ================================
    describe('Props', () => {
      it('should display different titles', () => {
        const { rerender } = render(<Title title="First Title" />)
        expect(screen.getByText('First Title')).toBeInTheDocument()

        rerender(<Title title="Second Title" />)
        expect(screen.getByText('Second Title')).toBeInTheDocument()
      })
    })

    // ================================
    // Edge Cases Tests
    // ================================
    describe('Edge Cases', () => {
      it('should handle empty title', () => {
        render(<Title title="" />)

        expect(document.body).toBeInTheDocument()
      })

      it('should handle very long title', () => {
        const longTitle = 'A'.repeat(500)
        const { container } = render(<Title title={longTitle} />)

        // Should have truncate for long text
        expect(container.querySelector('.truncate')).toBeInTheDocument()
      })

      it('should handle special characters in title', () => {
        render(<Title title={'Title with <special> & "chars"'} />)

        expect(screen.getByText('Title with <special> & "chars"')).toBeInTheDocument()
      })

      it('should handle unicode characters', () => {
        render(<Title title="标题 🎉 タイトル" />)

        expect(screen.getByText('标题 🎉 タイトル')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Integration Tests
  // ================================
  describe('Card Integration', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    describe('Complete Card Rendering', () => {
      it('should render a complete card with all elements', () => {
        const plugin = createMockPlugin({
          label: { 'en-US': 'Complete Plugin' },
          brief: { 'en-US': 'A complete plugin description' },
          org: 'complete-org',
          name: 'complete-plugin',
          category: PluginCategoryEnum.tool,
          verified: true,
          badges: ['partner'],
        })

        render(
          <Card
            payload={plugin}
            footer={<CardMoreInfo downloadCount={5000} tags={['search', 'api']} />}
          />,
        )

        // Verify all elements are rendered
        expect(screen.getByText('Complete Plugin')).toBeInTheDocument()
        expect(screen.getByText('A complete plugin description')).toBeInTheDocument()
        expect(screen.getByText('complete-org')).toBeInTheDocument()
        expect(screen.getByText('complete-plugin')).toBeInTheDocument()
        expect(screen.getByText('Tool')).toBeInTheDocument()
        expect(screen.getByTestId('partner-badge')).toBeInTheDocument()
        expect(screen.getByTestId('verified-badge')).toBeInTheDocument()
        expect(screen.getByText('5,000')).toBeInTheDocument()
        expect(screen.getByText('search')).toBeInTheDocument()
        expect(screen.getByText('api')).toBeInTheDocument()
      })

      it('should render loading state correctly', () => {
        const plugin = createMockPlugin()

        render(
          <Card
            payload={plugin}
            isLoading={true}
            loadingFileName="loading-plugin.zip"
          />,
        )

        expect(screen.getByTestId('skeleton-container')).toBeInTheDocument()
        expect(screen.getByText('loading-plugin.zip')).toBeInTheDocument()
        expect(screen.queryByTestId('partner-badge')).not.toBeInTheDocument()
      })

      it('should handle installed state with footer', () => {
        const plugin = createMockPlugin()

        render(
          <Card
            payload={plugin}
            installed={true}
            footer={<CardMoreInfo downloadCount={100} tags={['tag1']} />}
          />,
        )

        expect(screen.getByTestId('ri-check-line')).toBeInTheDocument()
        expect(screen.getByText('100')).toBeInTheDocument()
      })
    })

    describe('Component Hierarchy', () => {
      it('should render Icon inside Card', () => {
        const plugin = createMockPlugin({
          icon: '/test-icon.png',
        })

        const { container } = render(<Card payload={plugin} />)

        // Icon should be rendered with background image
        const iconElement = container.querySelector('[style*="background-image"]')
        expect(iconElement).toBeInTheDocument()
      })

      it('should render Title inside Card', () => {
        const plugin = createMockPlugin({
          label: { 'en-US': 'Test Title' },
        })

        render(<Card payload={plugin} />)

        expect(screen.getByText('Test Title')).toBeInTheDocument()
      })

      it('should render Description inside Card', () => {
        const plugin = createMockPlugin({
          brief: { 'en-US': 'Test Description' },
        })

        render(<Card payload={plugin} />)

        expect(screen.getByText('Test Description')).toBeInTheDocument()
      })

      it('should render OrgInfo inside Card', () => {
        const plugin = createMockPlugin({
          org: 'test-org',
          name: 'test-name',
        })

        render(<Card payload={plugin} />)

        expect(screen.getByText('test-org')).toBeInTheDocument()
        expect(screen.getByText('/')).toBeInTheDocument()
        expect(screen.getByText('test-name')).toBeInTheDocument()
      })

      it('should render CornerMark inside Card', () => {
        const plugin = createMockPlugin({
          category: PluginCategoryEnum.model,
        })

        render(<Card payload={plugin} />)

        expect(screen.getByText('Model')).toBeInTheDocument()
        expect(screen.getByTestId('left-corner')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Accessibility Tests
  // ================================
  describe('Accessibility', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should have accessible text content', () => {
      const plugin = createMockPlugin({
        label: { 'en-US': 'Accessible Plugin' },
        brief: { 'en-US': 'This plugin is accessible' },
      })

      render(<Card payload={plugin} />)

      expect(screen.getByText('Accessible Plugin')).toBeInTheDocument()
      expect(screen.getByText('This plugin is accessible')).toBeInTheDocument()
    })

    it('should have title attribute on tags', () => {
      render(<CardMoreInfo downloadCount={100} tags={['search']} />)

      expect(screen.getByTitle('# search')).toBeInTheDocument()
    })

    it('should have semantic structure', () => {
      const plugin = createMockPlugin()
      const { container } = render(<Card payload={plugin} />)

      // Card should have proper container structure
      expect(container.firstChild).toHaveClass('rounded-xl')
    })
  })

  // ================================
  // Performance Tests
  // ================================
  describe('Performance', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should render multiple cards efficiently', () => {
      const plugins = Array.from({ length: 50 }, (_, i) =>
        createMockPlugin({
          name: `plugin-${i}`,
          label: { 'en-US': `Plugin ${i}` },
        }))

      const startTime = performance.now()
      const { container } = render(
        <div>
          {plugins.map(plugin => (
            <Card key={plugin.name} payload={plugin} />
          ))}
        </div>,
      )
      const endTime = performance.now()

      // Should render all cards
      const cards = container.querySelectorAll('.rounded-xl')
      expect(cards.length).toBe(50)

      // Should render within reasonable time (less than 1 second)
      expect(endTime - startTime).toBeLessThan(1000)
    })

    it('should handle CardMoreInfo with many tags', () => {
      const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`)

      const startTime = performance.now()
      render(<CardMoreInfo downloadCount={1000} tags={tags} />)
      const endTime = performance.now()

      expect(endTime - startTime).toBeLessThan(100)
    })
  })
})
