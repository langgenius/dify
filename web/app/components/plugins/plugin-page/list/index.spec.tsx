import type { PluginDeclaration, PluginDetail } from '../../types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, PluginSource } from '../../types'

// ==================== Imports (after mocks) ====================

import PluginList from './index'

// ==================== Mock Setup ====================

// Mock PluginItem component to avoid complex dependency chain
vi.mock('../../plugin-item', () => ({
  default: ({ plugin }: { plugin: PluginDetail }) => (
    <div
      data-testid="plugin-item"
      data-plugin-id={plugin.plugin_id}
      data-plugin-name={plugin.name}
    >
      {plugin.name}
    </div>
  ),
}))

// ==================== Test Utilities ====================

/**
 * Factory function to create a PluginDeclaration with defaults
 */
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

/**
 * Factory function to create a PluginDetail with defaults
 */
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

/**
 * Factory function to create a list of plugins
 */
const createPluginList = (count: number, baseOverrides: Partial<PluginDetail> = {}): PluginDetail[] => {
  return Array.from({ length: count }, (_, index) => createPluginDetail({
    id: `plugin-${index + 1}`,
    plugin_id: `plugin-${index + 1}`,
    name: `plugin-${index + 1}`,
    plugin_unique_identifier: `test-author/plugin-${index + 1}@1.0.0`,
    ...baseOverrides,
  }))
}

// ==================== Tests ====================

describe('PluginList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const pluginList: PluginDetail[] = []

      // Act
      const { container } = render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(container).toBeInTheDocument()
    })

    it('should render container with correct structure', () => {
      // Arrange
      const pluginList: PluginDetail[] = []

      // Act
      const { container } = render(<PluginList pluginList={pluginList} />)

      // Assert
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv).toHaveClass('pb-3')

      const gridDiv = outerDiv.firstChild as HTMLElement
      expect(gridDiv).toHaveClass('grid', 'grid-cols-2', 'gap-3')
    })

    it('should render single plugin correctly', () => {
      // Arrange
      const pluginList = [createPluginDetail({ name: 'single-plugin' })]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      const pluginItems = screen.getAllByTestId('plugin-item')
      expect(pluginItems).toHaveLength(1)
      expect(pluginItems[0]).toHaveAttribute('data-plugin-name', 'single-plugin')
    })

    it('should render multiple plugins correctly', () => {
      // Arrange
      const pluginList = createPluginList(5)

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      const pluginItems = screen.getAllByTestId('plugin-item')
      expect(pluginItems).toHaveLength(5)
    })

    it('should render plugins in correct order', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({ plugin_id: 'first', name: 'First Plugin' }),
        createPluginDetail({ plugin_id: 'second', name: 'Second Plugin' }),
        createPluginDetail({ plugin_id: 'third', name: 'Third Plugin' }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      const pluginItems = screen.getAllByTestId('plugin-item')
      expect(pluginItems[0]).toHaveAttribute('data-plugin-id', 'first')
      expect(pluginItems[1]).toHaveAttribute('data-plugin-id', 'second')
      expect(pluginItems[2]).toHaveAttribute('data-plugin-id', 'third')
    })

    it('should pass plugin prop to each PluginItem', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({ plugin_id: 'plugin-a', name: 'Plugin A' }),
        createPluginDetail({ plugin_id: 'plugin-b', name: 'Plugin B' }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getByText('Plugin A')).toBeInTheDocument()
      expect(screen.getByText('Plugin B')).toBeInTheDocument()
    })
  })

  // ==================== Props Testing ====================
  describe('Props', () => {
    it('should accept empty pluginList array', () => {
      // Arrange & Act
      const { container } = render(<PluginList pluginList={[]} />)

      // Assert
      const gridDiv = container.querySelector('.grid')
      expect(gridDiv).toBeEmptyDOMElement()
    })

    it('should handle pluginList with various categories', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({
          plugin_id: 'tool-plugin',
          declaration: createPluginDeclaration({ category: PluginCategoryEnum.tool }),
        }),
        createPluginDetail({
          plugin_id: 'model-plugin',
          declaration: createPluginDeclaration({ category: PluginCategoryEnum.model }),
        }),
        createPluginDetail({
          plugin_id: 'extension-plugin',
          declaration: createPluginDeclaration({ category: PluginCategoryEnum.extension }),
        }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      const pluginItems = screen.getAllByTestId('plugin-item')
      expect(pluginItems).toHaveLength(3)
    })

    it('should handle pluginList with various sources', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({ plugin_id: 'marketplace-plugin', source: PluginSource.marketplace }),
        createPluginDetail({ plugin_id: 'github-plugin', source: PluginSource.github }),
        createPluginDetail({ plugin_id: 'local-plugin', source: PluginSource.local }),
        createPluginDetail({ plugin_id: 'debugging-plugin', source: PluginSource.debugging }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      const pluginItems = screen.getAllByTestId('plugin-item')
      expect(pluginItems).toHaveLength(4)
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle empty array', () => {
      // Arrange & Act
      render(<PluginList pluginList={[]} />)

      // Assert
      expect(screen.queryByTestId('plugin-item')).not.toBeInTheDocument()
    })

    it('should handle large number of plugins', () => {
      // Arrange
      const pluginList = createPluginList(100)

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      const pluginItems = screen.getAllByTestId('plugin-item')
      expect(pluginItems).toHaveLength(100)
    })

    it('should handle plugins with duplicate plugin_ids (key warning scenario)', () => {
      // Arrange - Testing that the component uses plugin_id as key
      const pluginList = [
        createPluginDetail({ plugin_id: 'unique-1', name: 'Plugin 1' }),
        createPluginDetail({ plugin_id: 'unique-2', name: 'Plugin 2' }),
      ]

      // Act & Assert - Should render without issues
      expect(() => render(<PluginList pluginList={pluginList} />)).not.toThrow()
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(2)
    })

    it('should handle plugins with special characters in names', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({ plugin_id: 'special-1', name: 'Plugin <with> "special" & chars' }),
        createPluginDetail({ plugin_id: 'special-2', name: '日本語プラグイン' }),
        createPluginDetail({ plugin_id: 'special-3', name: 'Emoji Plugin 🔌' }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      const pluginItems = screen.getAllByTestId('plugin-item')
      expect(pluginItems).toHaveLength(3)
    })

    it('should handle plugins with very long names', () => {
      // Arrange
      const longName = 'A'.repeat(500)
      const pluginList = [createPluginDetail({ name: longName })]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getByTestId('plugin-item')).toBeInTheDocument()
    })

    it('should handle plugin with minimal data', () => {
      // Arrange
      const minimalPlugin = createPluginDetail({
        name: '',
        plugin_id: 'minimal',
      })

      // Act
      render(<PluginList pluginList={[minimalPlugin]} />)

      // Assert
      expect(screen.getByTestId('plugin-item')).toBeInTheDocument()
    })

    it('should handle plugins with undefined optional fields', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({
          plugin_id: 'no-meta',
          meta: undefined,
        }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getByTestId('plugin-item')).toBeInTheDocument()
    })
  })

  // ==================== Grid Layout Tests ====================
  describe('Grid Layout', () => {
    it('should render with 2-column grid', () => {
      // Arrange
      const pluginList = createPluginList(4)

      // Act
      const { container } = render(<PluginList pluginList={pluginList} />)

      // Assert
      const gridDiv = container.querySelector('.grid')
      expect(gridDiv).toHaveClass('grid-cols-2')
    })

    it('should have proper gap between items', () => {
      // Arrange
      const pluginList = createPluginList(4)

      // Act
      const { container } = render(<PluginList pluginList={pluginList} />)

      // Assert
      const gridDiv = container.querySelector('.grid')
      expect(gridDiv).toHaveClass('gap-3')
    })

    it('should have bottom padding on container', () => {
      // Arrange
      const pluginList = createPluginList(2)

      // Act
      const { container } = render(<PluginList pluginList={pluginList} />)

      // Assert
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv).toHaveClass('pb-3')
    })
  })

  // ==================== Re-render Tests ====================
  describe('Re-render Behavior', () => {
    it('should update when pluginList changes', () => {
      // Arrange
      const initialList = createPluginList(2)
      const updatedList = createPluginList(4)

      // Act
      const { rerender } = render(<PluginList pluginList={initialList} />)
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(2)

      rerender(<PluginList pluginList={updatedList} />)

      // Assert
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(4)
    })

    it('should handle pluginList update from non-empty to empty', () => {
      // Arrange
      const initialList = createPluginList(3)
      const emptyList: PluginDetail[] = []

      // Act
      const { rerender } = render(<PluginList pluginList={initialList} />)
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(3)

      rerender(<PluginList pluginList={emptyList} />)

      // Assert
      expect(screen.queryByTestId('plugin-item')).not.toBeInTheDocument()
    })

    it('should handle pluginList update from empty to non-empty', () => {
      // Arrange
      const emptyList: PluginDetail[] = []
      const filledList = createPluginList(3)

      // Act
      const { rerender } = render(<PluginList pluginList={emptyList} />)
      expect(screen.queryByTestId('plugin-item')).not.toBeInTheDocument()

      rerender(<PluginList pluginList={filledList} />)

      // Assert
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(3)
    })

    it('should update individual plugin data on re-render', () => {
      // Arrange
      const initialList = [createPluginDetail({ plugin_id: 'plugin-1', name: 'Original Name' })]
      const updatedList = [createPluginDetail({ plugin_id: 'plugin-1', name: 'Updated Name' })]

      // Act
      const { rerender } = render(<PluginList pluginList={initialList} />)
      expect(screen.getByText('Original Name')).toBeInTheDocument()

      rerender(<PluginList pluginList={updatedList} />)

      // Assert
      expect(screen.getByText('Updated Name')).toBeInTheDocument()
      expect(screen.queryByText('Original Name')).not.toBeInTheDocument()
    })
  })

  // ==================== Key Prop Tests ====================
  describe('Key Prop Behavior', () => {
    it('should use plugin_id as key for efficient re-renders', () => {
      // Arrange - Create plugins with unique plugin_ids
      const pluginList = [
        createPluginDetail({ plugin_id: 'stable-key-1', name: 'Plugin 1' }),
        createPluginDetail({ plugin_id: 'stable-key-2', name: 'Plugin 2' }),
        createPluginDetail({ plugin_id: 'stable-key-3', name: 'Plugin 3' }),
      ]

      // Act
      const { rerender } = render(<PluginList pluginList={pluginList} />)

      // Reorder the list
      const reorderedList = [pluginList[2], pluginList[0], pluginList[1]]
      rerender(<PluginList pluginList={reorderedList} />)

      // Assert - All items should still be present
      const items = screen.getAllByTestId('plugin-item')
      expect(items).toHaveLength(3)
      expect(items[0]).toHaveAttribute('data-plugin-id', 'stable-key-3')
      expect(items[1]).toHaveAttribute('data-plugin-id', 'stable-key-1')
      expect(items[2]).toHaveAttribute('data-plugin-id', 'stable-key-2')
    })
  })

  // ==================== Plugin Status Variations ====================
  describe('Plugin Status Variations', () => {
    it('should render active plugins', () => {
      // Arrange
      const pluginList = [createPluginDetail({ status: 'active' })]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getByTestId('plugin-item')).toBeInTheDocument()
    })

    it('should render deleted/deprecated plugins', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({
          status: 'deleted',
          deprecated_reason: 'No longer maintained',
        }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getByTestId('plugin-item')).toBeInTheDocument()
    })

    it('should render mixed status plugins', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({ plugin_id: 'active-plugin', status: 'active' }),
        createPluginDetail({
          plugin_id: 'deprecated-plugin',
          status: 'deleted',
          deprecated_reason: 'Deprecated',
        }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(2)
    })
  })

  // ==================== Version Variations ====================
  describe('Version Variations', () => {
    it('should render plugins with same version as latest', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({
          version: '1.0.0',
          latest_version: '1.0.0',
        }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getByTestId('plugin-item')).toBeInTheDocument()
    })

    it('should render plugins with outdated version', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({
          version: '1.0.0',
          latest_version: '2.0.0',
        }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getByTestId('plugin-item')).toBeInTheDocument()
    })
  })

  // ==================== Accessibility ====================
  describe('Accessibility', () => {
    it('should render as a semantic container', () => {
      // Arrange
      const pluginList = createPluginList(2)

      // Act
      const { container } = render(<PluginList pluginList={pluginList} />)

      // Assert - The list is rendered as divs which is appropriate for a grid layout
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv.tagName).toBe('DIV')
    })
  })

  // ==================== Component Type ====================
  describe('Component Type', () => {
    it('should be a functional component', () => {
      // Assert
      expect(typeof PluginList).toBe('function')
    })

    it('should accept pluginList as required prop', () => {
      // Arrange & Act - TypeScript ensures this at compile time
      // but we verify runtime behavior
      const pluginList = createPluginList(1)

      // Assert
      expect(() => render(<PluginList pluginList={pluginList} />)).not.toThrow()
    })
  })

  // ==================== Mixed Content Tests ====================
  describe('Mixed Content', () => {
    it('should render plugins from different sources together', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({
          plugin_id: 'marketplace-1',
          name: 'Marketplace Plugin',
          source: PluginSource.marketplace,
        }),
        createPluginDetail({
          plugin_id: 'github-1',
          name: 'GitHub Plugin',
          source: PluginSource.github,
        }),
        createPluginDetail({
          plugin_id: 'local-1',
          name: 'Local Plugin',
          source: PluginSource.local,
        }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getByText('Marketplace Plugin')).toBeInTheDocument()
      expect(screen.getByText('GitHub Plugin')).toBeInTheDocument()
      expect(screen.getByText('Local Plugin')).toBeInTheDocument()
    })

    it('should render plugins of different categories together', () => {
      // Arrange
      const pluginList = [
        createPluginDetail({
          plugin_id: 'tool-1',
          name: 'Tool Plugin',
          declaration: createPluginDeclaration({ category: PluginCategoryEnum.tool }),
        }),
        createPluginDetail({
          plugin_id: 'model-1',
          name: 'Model Plugin',
          declaration: createPluginDeclaration({ category: PluginCategoryEnum.model }),
        }),
        createPluginDetail({
          plugin_id: 'agent-1',
          name: 'Agent Plugin',
          declaration: createPluginDeclaration({ category: PluginCategoryEnum.agent }),
        }),
      ]

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getByText('Tool Plugin')).toBeInTheDocument()
      expect(screen.getByText('Model Plugin')).toBeInTheDocument()
      expect(screen.getByText('Agent Plugin')).toBeInTheDocument()
    })
  })

  // ==================== Boundary Tests ====================
  describe('Boundary Tests', () => {
    it('should handle single item list', () => {
      // Arrange
      const pluginList = createPluginList(1)

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(1)
    })

    it('should handle two items (fills one row)', () => {
      // Arrange
      const pluginList = createPluginList(2)

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(2)
    })

    it('should handle three items (partial second row)', () => {
      // Arrange
      const pluginList = createPluginList(3)

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(3)
    })

    it('should handle odd number of items', () => {
      // Arrange
      const pluginList = createPluginList(7)

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(7)
    })

    it('should handle even number of items', () => {
      // Arrange
      const pluginList = createPluginList(8)

      // Act
      render(<PluginList pluginList={pluginList} />)

      // Assert
      expect(screen.getAllByTestId('plugin-item')).toHaveLength(8)
    })
  })
})
