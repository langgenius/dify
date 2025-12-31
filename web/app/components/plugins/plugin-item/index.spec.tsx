import type { PluginDeclaration, PluginDetail } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, PluginSource } from '../types'

// ==================== Imports (after mocks) ====================

import PluginItem from './index'

// ==================== Mock Setup ====================

// Mock theme hook
const mockTheme = vi.fn(() => 'light')
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme() }),
}))

// Mock i18n render hook
const mockGetValueFromI18nObject = vi.fn((obj: Record<string, string>) => obj?.en_US || '')
vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => mockGetValueFromI18nObject,
}))

// Mock categories hook
const mockCategoriesMap: Record<string, { name: string, label: string }> = {
  'tool': { name: 'tool', label: 'Tools' },
  'model': { name: 'model', label: 'Models' },
  'extension': { name: 'extension', label: 'Extensions' },
  'agent-strategy': { name: 'agent-strategy', label: 'Agents' },
  'datasource': { name: 'datasource', label: 'Data Sources' },
}
vi.mock('../hooks', () => ({
  useCategories: () => ({
    categories: Object.values(mockCategoriesMap),
    categoriesMap: mockCategoriesMap,
  }),
}))

// Mock plugin page context
const mockCurrentPluginID = vi.fn((): string | undefined => undefined)
const mockSetCurrentPluginID = vi.fn()
vi.mock('../plugin-page/context', () => ({
  usePluginPageContext: (selector: (v: any) => any) => {
    const context = {
      currentPluginID: mockCurrentPluginID(),
      setCurrentPluginID: mockSetCurrentPluginID,
    }
    return selector(context)
  },
}))

// Mock refresh plugin list hook
const mockRefreshPluginList = vi.fn()
vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

// Mock app context
const mockLangGeniusVersionInfo = vi.fn(() => ({
  current_version: '1.0.0',
}))
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    langGeniusVersionInfo: mockLangGeniusVersionInfo(),
  }),
}))

// Mock global public store
const mockEnableMarketplace = vi.fn(() => true)
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (s: any) => any) =>
    selector({ systemFeatures: { enable_marketplace: mockEnableMarketplace() } }),
}))

// Mock Action component
vi.mock('./action', () => ({
  default: ({ onDelete, pluginName }: { onDelete: () => void, pluginName: string }) => (
    <div data-testid="plugin-action" data-plugin-name={pluginName}>
      <button data-testid="delete-button" onClick={onDelete}>Delete</button>
    </div>
  ),
}))

// Mock child components
vi.mock('../card/base/corner-mark', () => ({
  default: ({ text }: { text: string }) => <div data-testid="corner-mark">{text}</div>,
}))

vi.mock('../card/base/title', () => ({
  default: ({ title }: { title: string }) => <div data-testid="plugin-title">{title}</div>,
}))

vi.mock('../card/base/description', () => ({
  default: ({ text }: { text: string }) => <div data-testid="plugin-description">{text}</div>,
}))

vi.mock('../card/base/org-info', () => ({
  default: ({ orgName, packageName }: { orgName: string, packageName: string }) => (
    <div data-testid="org-info" data-org={orgName} data-package={packageName}>
      {orgName}
      /
      {packageName}
    </div>
  ),
}))

vi.mock('../base/badges/verified', () => ({
  default: ({ text }: { text: string }) => <div data-testid="verified-badge">{text}</div>,
}))

vi.mock('../../base/badge', () => ({
  default: ({ text, hasRedCornerMark }: { text: string, hasRedCornerMark?: boolean }) => (
    <div data-testid="version-badge" data-has-update={hasRedCornerMark}>{text}</div>
  ),
}))

// ==================== Test Utilities ====================

const createPluginDeclaration = (overrides: Partial<PluginDeclaration> = {}): PluginDeclaration => ({
  plugin_unique_identifier: 'test-plugin-id',
  version: '1.0.0',
  author: 'test-author',
  icon: 'test-icon.png',
  icon_dark: 'test-icon-dark.png',
  name: 'test-plugin',
  category: PluginCategoryEnum.tool,
  label: { en_US: 'Test Plugin' } as any,
  description: { en_US: 'Test plugin description' } as any,
  created_at: '2024-01-01',
  resource: null,
  plugins: null,
  verified: false,
  endpoint: {} as any,
  model: null,
  tags: [],
  agent_strategy: null,
  meta: {
    version: '1.0.0',
    minimum_dify_version: '0.5.0',
  },
  trigger: {} as any,
  ...overrides,
})

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'plugin-1',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  name: 'test-plugin',
  plugin_id: 'plugin-1',
  plugin_unique_identifier: 'test-author/test-plugin@1.0.0',
  declaration: createPluginDeclaration(),
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-author/test-plugin@1.0.0',
  source: PluginSource.marketplace,
  meta: {
    repo: 'test-author/test-plugin',
    version: '1.0.0',
    package: 'test-plugin.difypkg',
  },
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

// ==================== Tests ====================

describe('PluginItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme.mockReturnValue('light')
    mockCurrentPluginID.mockReturnValue(undefined)
    mockEnableMarketplace.mockReturnValue(true)
    mockLangGeniusVersionInfo.mockReturnValue({ current_version: '1.0.0' })
    mockGetValueFromI18nObject.mockImplementation((obj: Record<string, string>) => obj?.en_US || '')
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render plugin item with basic info', () => {
      // Arrange
      const plugin = createPluginDetail()

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('plugin-title')).toBeInTheDocument()
      expect(screen.getByTestId('plugin-description')).toBeInTheDocument()
      expect(screen.getByTestId('corner-mark')).toBeInTheDocument()
      expect(screen.getByTestId('version-badge')).toBeInTheDocument()
    })

    it('should render plugin icon', () => {
      // Arrange
      const plugin = createPluginDetail()

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('alt', `plugin-${plugin.plugin_unique_identifier}-logo`)
    })

    it('should render category label in corner mark', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ category: PluginCategoryEnum.model }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('corner-mark')).toHaveTextContent('Models')
    })

    it('should apply custom className', () => {
      // Arrange
      const plugin = createPluginDetail()

      // Act
      const { container } = render(<PluginItem plugin={plugin} className="custom-class" />)

      // Assert
      const innerDiv = container.querySelector('.custom-class')
      expect(innerDiv).toBeInTheDocument()
    })
  })

  // ==================== Plugin Sources Tests ====================
  describe('Plugin Sources', () => {
    it('should render GitHub source with repo link', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: '1.0.0', package: 'pkg.difypkg' },
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      const githubLink = screen.getByRole('link')
      expect(githubLink).toHaveAttribute('href', 'https://github.com/owner/repo')
      expect(screen.getByText('GitHub')).toBeInTheDocument()
    })

    it('should render marketplace source with link when enabled', () => {
      // Arrange
      mockEnableMarketplace.mockReturnValue(true)
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        declaration: createPluginDeclaration({ author: 'test-author', name: 'test-plugin' }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByText('marketplace')).toBeInTheDocument()
    })

    it('should render local source indicator', () => {
      // Arrange
      const plugin = createPluginDetail({ source: PluginSource.local })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByText('Local Plugin')).toBeInTheDocument()
    })

    it('should render debugging source indicator', () => {
      // Arrange
      const plugin = createPluginDetail({ source: PluginSource.debugging })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByText('Debugging Plugin')).toBeInTheDocument()
    })

    it('should show org info for GitHub source', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.github,
        declaration: createPluginDeclaration({ author: 'github-author' }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('org-info')).toHaveAttribute('data-org', 'github-author')
    })

    it('should show org info for marketplace source', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        declaration: createPluginDeclaration({ author: 'marketplace-author' }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('org-info')).toHaveAttribute('data-org', 'marketplace-author')
    })

    it('should not show org info for local source', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.local,
        declaration: createPluginDeclaration({ author: 'local-author' }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('org-info')).toHaveAttribute('data-org', '')
    })
  })

  // ==================== Extension Category Tests ====================
  describe('Extension Category', () => {
    it('should show endpoints info for extension category', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ category: PluginCategoryEnum.extension }),
        endpoints_active: 3,
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert - The translation includes interpolation
      expect(screen.getByText(/plugin\.endpointsEnabled/)).toBeInTheDocument()
    })

    it('should not show endpoints info for non-extension category', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ category: PluginCategoryEnum.tool }),
        endpoints_active: 3,
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.queryByText(/plugin\.endpointsEnabled/)).not.toBeInTheDocument()
    })
  })

  // ==================== Version Compatibility Tests ====================
  describe('Version Compatibility', () => {
    it('should show warning icon when Dify version is not compatible', () => {
      // Arrange
      mockLangGeniusVersionInfo.mockReturnValue({ current_version: '0.3.0' })
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({
          meta: { version: '1.0.0', minimum_dify_version: '0.5.0' },
        }),
      })

      // Act
      const { container } = render(<PluginItem plugin={plugin} />)

      // Assert - Warning icon should be rendered
      const warningIcon = container.querySelector('.text-text-accent')
      expect(warningIcon).toBeInTheDocument()
    })

    it('should not show warning when Dify version is compatible', () => {
      // Arrange
      mockLangGeniusVersionInfo.mockReturnValue({ current_version: '1.0.0' })
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({
          meta: { version: '1.0.0', minimum_dify_version: '0.5.0' },
        }),
      })

      // Act
      const { container } = render(<PluginItem plugin={plugin} />)

      // Assert
      const warningIcon = container.querySelector('.text-text-accent')
      expect(warningIcon).not.toBeInTheDocument()
    })

    it('should handle missing current_version gracefully', () => {
      // Arrange
      mockLangGeniusVersionInfo.mockReturnValue({ current_version: '' })
      const plugin = createPluginDetail()

      // Act
      const { container } = render(<PluginItem plugin={plugin} />)

      // Assert - Should not crash and not show warning
      const warningIcon = container.querySelector('.text-text-accent')
      expect(warningIcon).not.toBeInTheDocument()
    })

    it('should handle missing minimum_dify_version gracefully', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({
          meta: { version: '1.0.0' },
        }),
      })

      // Act
      const { container } = render(<PluginItem plugin={plugin} />)

      // Assert - Should not crash and not show warning
      const warningIcon = container.querySelector('.text-text-accent')
      expect(warningIcon).not.toBeInTheDocument()
    })
  })

  // ==================== Deprecated Plugin Tests ====================
  describe('Deprecated Plugin', () => {
    it('should show deprecated indicator for deprecated marketplace plugin', () => {
      // Arrange
      mockEnableMarketplace.mockReturnValue(true)
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        status: 'deleted',
        deprecated_reason: 'Plugin is no longer maintained',
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByText('plugin.deprecated')).toBeInTheDocument()
    })

    it('should show background effect for deprecated plugin', () => {
      // Arrange
      mockEnableMarketplace.mockReturnValue(true)
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        status: 'deleted',
        deprecated_reason: 'Plugin is deprecated',
      })

      // Act
      const { container } = render(<PluginItem plugin={plugin} />)

      // Assert
      const bgEffect = container.querySelector('.blur-\\[120px\\]')
      expect(bgEffect).toBeInTheDocument()
    })

    it('should not show deprecated indicator for active plugin', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        status: 'active',
        deprecated_reason: '',
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.queryByText('plugin.deprecated')).not.toBeInTheDocument()
    })

    it('should not show deprecated indicator for non-marketplace source', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.github,
        status: 'deleted',
        deprecated_reason: 'Some reason',
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.queryByText('plugin.deprecated')).not.toBeInTheDocument()
    })

    it('should not show deprecated when marketplace is disabled', () => {
      // Arrange
      mockEnableMarketplace.mockReturnValue(false)
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        status: 'deleted',
        deprecated_reason: 'Some reason',
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.queryByText('plugin.deprecated')).not.toBeInTheDocument()
    })
  })

  // ==================== Verified Badge Tests ====================
  describe('Verified Badge', () => {
    it('should show verified badge for verified plugin', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ verified: true }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('verified-badge')).toBeInTheDocument()
    })

    it('should not show verified badge for unverified plugin', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ verified: false }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.queryByTestId('verified-badge')).not.toBeInTheDocument()
    })
  })

  // ==================== Version Badge Tests ====================
  describe('Version Badge', () => {
    it('should show version from meta for GitHub source', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.github,
        version: '2.0.0',
        meta: { repo: 'owner/repo', version: '1.5.0', package: 'pkg' },
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('version-badge')).toHaveTextContent('1.5.0')
    })

    it('should show version from plugin for marketplace source', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        version: '2.0.0',
        meta: { repo: 'owner/repo', version: '1.5.0', package: 'pkg' },
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('version-badge')).toHaveTextContent('2.0.0')
    })

    it('should show update indicator when new version available', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        version: '1.0.0',
        latest_version: '2.0.0',
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('version-badge')).toHaveAttribute('data-has-update', 'true')
    })

    it('should not show update indicator when version is latest', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        version: '1.0.0',
        latest_version: '1.0.0',
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('version-badge')).toHaveAttribute('data-has-update', 'false')
    })

    it('should not show update indicator for non-marketplace source', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.github,
        version: '1.0.0',
        latest_version: '2.0.0',
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('version-badge')).toHaveAttribute('data-has-update', 'false')
    })
  })

  // ==================== User Interactions Tests ====================
  describe('User Interactions', () => {
    it('should call setCurrentPluginID when plugin is clicked', () => {
      // Arrange
      const plugin = createPluginDetail({ plugin_id: 'test-plugin-id' })

      // Act
      const { container } = render(<PluginItem plugin={plugin} />)
      const pluginContainer = container.firstChild as HTMLElement
      fireEvent.click(pluginContainer)

      // Assert
      expect(mockSetCurrentPluginID).toHaveBeenCalledWith('test-plugin-id')
    })

    it('should highlight selected plugin', () => {
      // Arrange
      mockCurrentPluginID.mockReturnValue('test-plugin-id')
      const plugin = createPluginDetail({ plugin_id: 'test-plugin-id' })

      // Act
      const { container } = render(<PluginItem plugin={plugin} />)

      // Assert
      const pluginContainer = container.firstChild as HTMLElement
      expect(pluginContainer).toHaveClass('border-components-option-card-option-selected-border')
    })

    it('should not highlight unselected plugin', () => {
      // Arrange
      mockCurrentPluginID.mockReturnValue('other-plugin-id')
      const plugin = createPluginDetail({ plugin_id: 'test-plugin-id' })

      // Act
      const { container } = render(<PluginItem plugin={plugin} />)

      // Assert
      const pluginContainer = container.firstChild as HTMLElement
      expect(pluginContainer).not.toHaveClass('border-components-option-card-option-selected-border')
    })

    it('should stop propagation when action area is clicked', () => {
      // Arrange
      const plugin = createPluginDetail()

      // Act
      render(<PluginItem plugin={plugin} />)
      const actionArea = screen.getByTestId('plugin-action').parentElement
      fireEvent.click(actionArea!)

      // Assert - setCurrentPluginID should not be called
      expect(mockSetCurrentPluginID).not.toHaveBeenCalled()
    })
  })

  // ==================== Delete Callback Tests ====================
  describe('Delete Callback', () => {
    it('should call refreshPluginList when delete is triggered', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ category: PluginCategoryEnum.tool }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)
      fireEvent.click(screen.getByTestId('delete-button'))

      // Assert
      expect(mockRefreshPluginList).toHaveBeenCalledWith({ category: PluginCategoryEnum.tool })
    })

    it('should pass correct category to refreshPluginList', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ category: PluginCategoryEnum.model }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)
      fireEvent.click(screen.getByTestId('delete-button'))

      // Assert
      expect(mockRefreshPluginList).toHaveBeenCalledWith({ category: PluginCategoryEnum.model })
    })
  })

  // ==================== Theme Tests ====================
  describe('Theme Support', () => {
    it('should use dark icon when theme is dark and dark icon exists', () => {
      // Arrange
      mockTheme.mockReturnValue('dark')
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({
          icon: 'light-icon.png',
          icon_dark: 'dark-icon.png',
        }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      const img = screen.getByRole('img')
      expect(img.getAttribute('src')).toContain('dark-icon.png')
    })

    it('should use light icon when theme is light', () => {
      // Arrange
      mockTheme.mockReturnValue('light')
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({
          icon: 'light-icon.png',
          icon_dark: 'dark-icon.png',
        }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      const img = screen.getByRole('img')
      expect(img.getAttribute('src')).toContain('light-icon.png')
    })

    it('should use light icon when dark icon is not available', () => {
      // Arrange
      mockTheme.mockReturnValue('dark')
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({
          icon: 'light-icon.png',
          icon_dark: undefined,
        }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      const img = screen.getByRole('img')
      expect(img.getAttribute('src')).toContain('light-icon.png')
    })

    it('should use external URL directly for icon', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({
          icon: 'https://example.com/icon.png',
        }),
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'https://example.com/icon.png')
    })
  })

  // ==================== Memoization Tests ====================
  describe('Memoization', () => {
    it('should memoize orgName based on source and author', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.github,
        declaration: createPluginDeclaration({ author: 'test-author' }),
      })

      // Act
      const { rerender } = render(<PluginItem plugin={plugin} />)

      // First render should show author
      expect(screen.getByTestId('org-info')).toHaveAttribute('data-org', 'test-author')

      // Re-render with same plugin
      rerender(<PluginItem plugin={plugin} />)

      // Should still show same author
      expect(screen.getByTestId('org-info')).toHaveAttribute('data-org', 'test-author')
    })

    it('should update orgName when source changes', () => {
      // Arrange
      const githubPlugin = createPluginDetail({
        source: PluginSource.github,
        declaration: createPluginDeclaration({ author: 'github-author' }),
      })
      const localPlugin = createPluginDetail({
        source: PluginSource.local,
        declaration: createPluginDeclaration({ author: 'local-author' }),
      })

      // Act
      const { rerender } = render(<PluginItem plugin={githubPlugin} />)
      expect(screen.getByTestId('org-info')).toHaveAttribute('data-org', 'github-author')

      rerender(<PluginItem plugin={localPlugin} />)
      expect(screen.getByTestId('org-info')).toHaveAttribute('data-org', '')
    })

    it('should memoize isDeprecated based on status and deprecated_reason', () => {
      // Arrange
      mockEnableMarketplace.mockReturnValue(true)
      const activePlugin = createPluginDetail({
        source: PluginSource.marketplace,
        status: 'active',
        deprecated_reason: '',
      })
      const deprecatedPlugin = createPluginDetail({
        source: PluginSource.marketplace,
        status: 'deleted',
        deprecated_reason: 'Deprecated',
      })

      // Act
      const { rerender } = render(<PluginItem plugin={activePlugin} />)
      expect(screen.queryByText('plugin.deprecated')).not.toBeInTheDocument()

      rerender(<PluginItem plugin={deprecatedPlugin} />)
      expect(screen.getByText('plugin.deprecated')).toBeInTheDocument()
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle empty icon gracefully', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ icon: '' }),
      })

      // Act & Assert - Should not throw when icon is empty
      expect(() => render(<PluginItem plugin={plugin} />)).not.toThrow()

      // The img element should still be rendered
      const img = screen.getByRole('img')
      expect(img).toBeInTheDocument()
    })

    it('should handle missing meta for non-GitHub source', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.local,
        meta: undefined,
      })

      // Act & Assert - Should not throw
      expect(() => render(<PluginItem plugin={plugin} />)).not.toThrow()
    })

    it('should handle empty label gracefully', () => {
      // Arrange
      mockGetValueFromI18nObject.mockReturnValue('')
      const plugin = createPluginDetail()

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert
      expect(screen.getByTestId('plugin-title')).toHaveTextContent('')
    })

    it('should handle zero endpoints_active', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ category: PluginCategoryEnum.extension }),
        endpoints_active: 0,
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert - Should still render endpoints info with zero
      expect(screen.getByText(/plugin\.endpointsEnabled/)).toBeInTheDocument()
    })

    it('should handle null latest_version', () => {
      // Arrange
      const plugin = createPluginDetail({
        source: PluginSource.marketplace,
        version: '1.0.0',
        latest_version: null as any,
      })

      // Act
      render(<PluginItem plugin={plugin} />)

      // Assert - Should not show update indicator
      expect(screen.getByTestId('version-badge')).toHaveAttribute('data-has-update', 'false')
    })
  })

  // ==================== Prop Variations ====================
  describe('Prop Variations', () => {
    it('should render correctly with minimal required props', () => {
      // Arrange
      const plugin = createPluginDetail()

      // Act & Assert
      expect(() => render(<PluginItem plugin={plugin} />)).not.toThrow()
    })

    it('should handle different category types', () => {
      // Arrange
      const categories = [
        PluginCategoryEnum.tool,
        PluginCategoryEnum.model,
        PluginCategoryEnum.extension,
        PluginCategoryEnum.agent,
        PluginCategoryEnum.datasource,
      ]

      categories.forEach((category) => {
        const plugin = createPluginDetail({
          declaration: createPluginDeclaration({ category }),
        })

        // Act & Assert
        expect(() => render(<PluginItem plugin={plugin} />)).not.toThrow()
      })
    })

    it('should handle all source types', () => {
      // Arrange
      const sources = [
        PluginSource.marketplace,
        PluginSource.github,
        PluginSource.local,
        PluginSource.debugging,
      ]

      sources.forEach((source) => {
        const plugin = createPluginDetail({ source })

        // Act & Assert
        expect(() => render(<PluginItem plugin={plugin} />)).not.toThrow()
      })
    })
  })

  // ==================== Callback Stability Tests ====================
  describe('Callback Stability', () => {
    it('should have stable handleDelete callback', () => {
      // Arrange
      const plugin = createPluginDetail({
        declaration: createPluginDeclaration({ category: PluginCategoryEnum.tool }),
      })

      // Act
      const { rerender } = render(<PluginItem plugin={plugin} />)
      fireEvent.click(screen.getByTestId('delete-button'))
      const firstCallArgs = mockRefreshPluginList.mock.calls[0]

      mockRefreshPluginList.mockClear()
      rerender(<PluginItem plugin={plugin} />)
      fireEvent.click(screen.getByTestId('delete-button'))
      const secondCallArgs = mockRefreshPluginList.mock.calls[0]

      // Assert - Both calls should have same arguments
      expect(firstCallArgs).toEqual(secondCallArgs)
    })

    it('should update handleDelete when category changes', () => {
      // Arrange
      const toolPlugin = createPluginDetail({
        declaration: createPluginDeclaration({ category: PluginCategoryEnum.tool }),
      })
      const modelPlugin = createPluginDetail({
        declaration: createPluginDeclaration({ category: PluginCategoryEnum.model }),
      })

      // Act
      const { rerender } = render(<PluginItem plugin={toolPlugin} />)
      fireEvent.click(screen.getByTestId('delete-button'))
      expect(mockRefreshPluginList).toHaveBeenCalledWith({ category: PluginCategoryEnum.tool })

      mockRefreshPluginList.mockClear()
      rerender(<PluginItem plugin={modelPlugin} />)
      fireEvent.click(screen.getByTestId('delete-button'))
      expect(mockRefreshPluginList).toHaveBeenCalledWith({ category: PluginCategoryEnum.model })
    })
  })

  // ==================== React.memo Tests ====================
  describe('React.memo Behavior', () => {
    it('should be wrapped with React.memo', () => {
      // Arrange & Assert
      // The component is exported as React.memo(PluginItem)
      // We can verify by checking the displayName or type
      expect(PluginItem).toBeDefined()
      // React.memo components have a $$typeof property
      expect((PluginItem as any).$$typeof?.toString()).toContain('Symbol')
    })
  })
})
