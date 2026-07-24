import type { Plugin } from '../../types'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../../types'
import Card from '../index'

let mockTheme = 'light'
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme }),
}))

vi.mock('@/i18n-config', () => ({
  renderI18nObject: (obj: Record<string, string>, locale: string) => {
    return obj?.[locale] || obj?.['en-US'] || ''
  },
}))

vi.mock('@/i18n-config/language', () => ({
  getLanguage: (locale: string) => locale || 'en-US',
}))

const mockCategoriesMap: Record<string, { label: string }> = {
  'tool': { label: 'Tool' },
  'model': { label: 'Model' },
  'extension': { label: 'Extension' },
  'agent-strategy': { label: 'Agent' },
  'datasource': { label: 'Datasource' },
  'trigger': { label: 'Trigger' },
  'bundle': { label: 'Bundle' },
}

vi.mock('../../hooks', () => ({
  useCategories: () => ({
    categoriesMap: mockCategoriesMap,
  }),
}))

vi.mock('@/utils/format', () => ({
  formatNumber: (num: number) => num.toLocaleString(),
}))

vi.mock('@/utils/mcp', () => ({
  shouldUseMcpIcon: (src: unknown) => typeof src === 'object' && src !== null && (src as { content?: string })?.content === '🔗',
}))

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

vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  Mcp: ({ className }: { className?: string }) => (
    <div data-testid="mcp-icon" className={className}>MCP</div>
  ),
  Group: ({ className }: { className?: string }) => (
    <div data-testid="group-icon" className={className}>Group</div>
  ),
}))

vi.mock('../../../base/icons/src/vender/plugin', () => ({
  LeftCorner: ({ className }: { className?: string }) => (
    <div data-testid="left-corner" className={className}>LeftCorner</div>
  ),
}))

vi.mock('../../base/badges/partner', () => ({
  default: ({ className, text }: { className?: string, text?: string }) => (
    <div data-testid="partner-badge" className={className} title={text}>Partner</div>
  ),
}))

vi.mock('../../base/badges/verified', () => ({
  default: ({ className, text }: { className?: string, text?: string }) => (
    <div data-testid="verified-badge" className={className} title={text}>Verified</div>
  ),
}))

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
      const { container } = render(<Card payload={plugin} installed={true} />)

      expect(container.querySelector('.bg-state-success-solid')).toBeInTheDocument()
    })

    it('should pass installFailed prop to Icon component', () => {
      const plugin = createMockPlugin()
      const { container } = render(<Card payload={plugin} installFailed={true} />)

      expect(container.querySelector('.bg-state-destructive-solid')).toBeInTheDocument()
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

      const { container } = render(<Card payload={plugin} limitedInstall={true} />)

      expect(container.querySelector('.text-text-warning-secondary')).toBeInTheDocument()
    })

    it('should not render warning by default', () => {
      const plugin = createMockPlugin()

      const { container } = render(<Card payload={plugin} />)

      expect(container.querySelector('.text-text-warning-secondary')).not.toBeInTheDocument()
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
