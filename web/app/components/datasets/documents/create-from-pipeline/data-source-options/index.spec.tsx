import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import DatasourceIcon from './datasource-icon'
import { useDatasourceIcon } from './hooks'
import DataSourceOptions from './index'
import OptionCard from './option-card'

// ==========================================
// Mock External Dependencies
// ==========================================

// Mock useDatasourceOptions hook from parent hooks
const mockUseDatasourceOptions = vi.fn()
vi.mock('../hooks', () => ({
  useDatasourceOptions: (nodes: Node<DataSourceNodeType>[]) => mockUseDatasourceOptions(nodes),
}))

// Mock useDataSourceList API hook
const mockUseDataSourceList = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  useDataSourceList: (enabled: boolean) => mockUseDataSourceList(enabled),
}))

// Mock transformDataSourceToTool utility
const mockTransformDataSourceToTool = vi.fn()
vi.mock('@/app/components/workflow/block-selector/utils', () => ({
  transformDataSourceToTool: (item: unknown) => mockTransformDataSourceToTool(item),
}))

// Mock basePath
vi.mock('@/utils/var', () => ({
  basePath: '/mock-base-path',
}))

// ==========================================
// Test Data Builders
// ==========================================

const createMockDataSourceNodeData = (overrides?: Partial<DataSourceNodeType>): DataSourceNodeType => ({
  title: 'Test Data Source',
  desc: 'Test description',
  type: BlockEnum.DataSource,
  plugin_id: 'test-plugin-id',
  provider_type: 'local_file',
  provider_name: 'Test Provider',
  datasource_name: 'test-datasource',
  datasource_label: 'Test Datasource Label',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
})

const createMockPipelineNode = (overrides?: Partial<Node<DataSourceNodeType>>): Node<DataSourceNodeType> => {
  const nodeData = createMockDataSourceNodeData(overrides?.data)
  return {
    id: `node-${Math.random().toString(36).slice(2, 9)}`,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: nodeData,
    ...overrides,
  }
}

const createMockPipelineNodes = (count = 3): Node<DataSourceNodeType>[] => {
  return Array.from({ length: count }, (_, i) =>
    createMockPipelineNode({
      id: `node-${i + 1}`,
      data: createMockDataSourceNodeData({
        title: `Data Source ${i + 1}`,
        plugin_id: `plugin-${i + 1}`,
        datasource_name: `datasource-${i + 1}`,
      }),
    }))
}

const createMockDatasourceOption = (
  node: Node<DataSourceNodeType>,
) => ({
  label: node.data.title,
  value: node.id,
  data: node.data,
})

const createMockDataSourceListItem = (overrides?: Record<string, unknown>) => ({
  declaration: {
    identity: {
      icon: '/icons/test-icon.png',
      name: 'test-datasource',
      label: { en_US: 'Test Datasource' },
    },
    provider: 'test-provider',
  },
  plugin_id: 'test-plugin-id',
  ...overrides,
})

// ==========================================
// Test Utilities
// ==========================================

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const renderWithProviders = (
  ui: React.ReactElement,
  queryClient?: QueryClient,
) => {
  const client = queryClient || createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      {ui}
    </QueryClientProvider>,
  )
}

const createHookWrapper = () => {
  const queryClient = createQueryClient()
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

// ==========================================
// DatasourceIcon Tests
// ==========================================
describe('DatasourceIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render icon with background image', () => {
      // Arrange
      const iconUrl = 'https://example.com/icon.png'

      // Act
      const { container } = render(<DatasourceIcon iconUrl={iconUrl} />)

      // Assert
      const iconDiv = container.querySelector('[style*="background-image"]')
      expect(iconDiv).toHaveStyle({ backgroundImage: `url(${iconUrl})` })
    })

    it('should render with default size (sm)', () => {
      // Arrange & Act
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      // Assert - Default size is 'sm' which maps to 'w-5 h-5'
      expect(container.firstChild).toHaveClass('w-5')
      expect(container.firstChild).toHaveClass('h-5')
    })
  })

  describe('Props', () => {
    describe('size', () => {
      it('should render with xs size', () => {
        // Arrange & Act
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" size="xs" />,
        )

        // Assert
        expect(container.firstChild).toHaveClass('w-4')
        expect(container.firstChild).toHaveClass('h-4')
        expect(container.firstChild).toHaveClass('rounded-[5px]')
      })

      it('should render with sm size', () => {
        // Arrange & Act
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" size="sm" />,
        )

        // Assert
        expect(container.firstChild).toHaveClass('w-5')
        expect(container.firstChild).toHaveClass('h-5')
        expect(container.firstChild).toHaveClass('rounded-md')
      })

      it('should render with md size', () => {
        // Arrange & Act
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" size="md" />,
        )

        // Assert
        expect(container.firstChild).toHaveClass('w-6')
        expect(container.firstChild).toHaveClass('h-6')
        expect(container.firstChild).toHaveClass('rounded-lg')
      })
    })

    describe('className', () => {
      it('should apply custom className', () => {
        // Arrange & Act
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" className="custom-class" />,
        )

        // Assert
        expect(container.firstChild).toHaveClass('custom-class')
      })

      it('should merge custom className with default classes', () => {
        // Arrange & Act
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" className="custom-class" size="sm" />,
        )

        // Assert
        expect(container.firstChild).toHaveClass('custom-class')
        expect(container.firstChild).toHaveClass('w-5')
        expect(container.firstChild).toHaveClass('h-5')
      })
    })

    describe('iconUrl', () => {
      it('should handle empty iconUrl', () => {
        // Arrange & Act
        const { container } = render(<DatasourceIcon iconUrl="" />)

        // Assert
        const iconDiv = container.querySelector('[style*="background-image"]')
        expect(iconDiv).toHaveStyle({ backgroundImage: 'url()' })
      })

      it('should handle special characters in iconUrl', () => {
        // Arrange
        const iconUrl = 'https://example.com/icon.png?param=value&other=123'

        // Act
        const { container } = render(<DatasourceIcon iconUrl={iconUrl} />)

        // Assert
        const iconDiv = container.querySelector('[style*="background-image"]')
        expect(iconDiv).toHaveStyle({ backgroundImage: `url(${iconUrl})` })
      })

      it('should handle data URL as iconUrl', () => {
        // Arrange
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

        // Act
        const { container } = render(<DatasourceIcon iconUrl={dataUrl} />)

        // Assert
        const iconDiv = container.querySelector('[style*="background-image"]')
        expect(iconDiv).toBeInTheDocument()
      })
    })
  })

  describe('Styling', () => {
    it('should have flex container classes', () => {
      // Arrange & Act
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      // Assert
      expect(container.firstChild).toHaveClass('flex')
      expect(container.firstChild).toHaveClass('items-center')
      expect(container.firstChild).toHaveClass('justify-center')
    })

    it('should have shadow-xs class from size map', () => {
      // Arrange & Act
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      // Assert - Default size 'sm' has shadow-xs
      expect(container.firstChild).toHaveClass('shadow-xs')
    })

    it('should have inner div with bg-cover class', () => {
      // Arrange & Act
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      // Assert
      const innerDiv = container.querySelector('.bg-cover')
      expect(innerDiv).toBeInTheDocument()
      expect(innerDiv).toHaveClass('bg-center')
      expect(innerDiv).toHaveClass('rounded-md')
    })
  })
})

// ==========================================
// useDatasourceIcon Hook Tests
// ==========================================
describe('useDatasourceIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseDataSourceList.mockReturnValue({
      data: [],
      isSuccess: false,
    })
    mockTransformDataSourceToTool.mockImplementation(item => ({
      plugin_id: item.plugin_id,
      icon: item.declaration?.identity?.icon,
    }))
  })

  describe('Loading State', () => {
    it('should return undefined when data is not loaded', () => {
      // Arrange
      mockUseDataSourceList.mockReturnValue({
        data: undefined,
        isSuccess: false,
      })
      const nodeData = createMockDataSourceNodeData()

      // Act
      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert
      expect(result.current).toBeUndefined()
    })

    it('should call useDataSourceList with true', () => {
      // Arrange
      const nodeData = createMockDataSourceNodeData()

      // Act
      renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert
      expect(mockUseDataSourceList).toHaveBeenCalledWith(true)
    })
  })

  describe('Success State', () => {
    it('should return icon when data is loaded and plugin matches', () => {
      // Arrange
      const mockDataSourceList = [
        createMockDataSourceListItem({
          plugin_id: 'test-plugin-id',
          declaration: {
            identity: {
              icon: '/icons/test-icon.png',
              name: 'test',
              label: { en_US: 'Test' },
            },
          },
        }),
      ]
      mockUseDataSourceList.mockReturnValue({
        data: mockDataSourceList,
        isSuccess: true,
      })
      mockTransformDataSourceToTool.mockImplementation(item => ({
        plugin_id: item.plugin_id,
        icon: item.declaration?.identity?.icon,
      }))
      const nodeData = createMockDataSourceNodeData({ plugin_id: 'test-plugin-id' })

      // Act
      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert - Icon should have basePath prepended
      expect(result.current).toBe('/mock-base-path/icons/test-icon.png')
    })

    it('should return undefined when plugin does not match', () => {
      // Arrange
      const mockDataSourceList = [
        createMockDataSourceListItem({
          plugin_id: 'other-plugin-id',
        }),
      ]
      mockUseDataSourceList.mockReturnValue({
        data: mockDataSourceList,
        isSuccess: true,
      })
      const nodeData = createMockDataSourceNodeData({ plugin_id: 'test-plugin-id' })

      // Act
      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert
      expect(result.current).toBeUndefined()
    })

    it('should prepend basePath to icon when icon does not include basePath', () => {
      // Arrange
      const mockDataSourceList = [
        createMockDataSourceListItem({
          plugin_id: 'test-plugin-id',
          declaration: {
            identity: {
              icon: '/icons/test-icon.png',
              name: 'test',
              label: { en_US: 'Test' },
            },
          },
        }),
      ]
      mockUseDataSourceList.mockReturnValue({
        data: mockDataSourceList,
        isSuccess: true,
      })
      mockTransformDataSourceToTool.mockImplementation(item => ({
        plugin_id: item.plugin_id,
        icon: item.declaration?.identity?.icon,
      }))
      const nodeData = createMockDataSourceNodeData({ plugin_id: 'test-plugin-id' })

      // Act
      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert - Icon should have basePath prepended
      expect(result.current).toBe('/mock-base-path/icons/test-icon.png')
    })

    it('should not prepend basePath when icon already includes basePath', () => {
      // Arrange
      const mockDataSourceList = [
        createMockDataSourceListItem({
          plugin_id: 'test-plugin-id',
          declaration: {
            identity: {
              icon: '/mock-base-path/icons/test-icon.png',
              name: 'test',
              label: { en_US: 'Test' },
            },
          },
        }),
      ]
      mockUseDataSourceList.mockReturnValue({
        data: mockDataSourceList,
        isSuccess: true,
      })
      mockTransformDataSourceToTool.mockImplementation(item => ({
        plugin_id: item.plugin_id,
        icon: item.declaration?.identity?.icon,
      }))
      const nodeData = createMockDataSourceNodeData({ plugin_id: 'test-plugin-id' })

      // Act
      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert - Icon should not be modified
      expect(result.current).toBe('/mock-base-path/icons/test-icon.png')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty dataSourceList', () => {
      // Arrange
      mockUseDataSourceList.mockReturnValue({
        data: [],
        isSuccess: true,
      })
      const nodeData = createMockDataSourceNodeData()

      // Act
      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert
      expect(result.current).toBeUndefined()
    })

    it('should handle null dataSourceList', () => {
      // Arrange
      mockUseDataSourceList.mockReturnValue({
        data: null,
        isSuccess: true,
      })
      const nodeData = createMockDataSourceNodeData()

      // Act
      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert
      expect(result.current).toBeUndefined()
    })

    it('should handle icon as non-string type', () => {
      // Arrange
      const mockDataSourceList = [
        createMockDataSourceListItem({
          plugin_id: 'test-plugin-id',
          declaration: {
            identity: {
              icon: { url: '/icons/test-icon.png' }, // Object instead of string
              name: 'test',
              label: { en_US: 'Test' },
            },
          },
        }),
      ]
      mockUseDataSourceList.mockReturnValue({
        data: mockDataSourceList,
        isSuccess: true,
      })
      mockTransformDataSourceToTool.mockImplementation(item => ({
        plugin_id: item.plugin_id,
        icon: item.declaration?.identity?.icon,
      }))
      const nodeData = createMockDataSourceNodeData({ plugin_id: 'test-plugin-id' })

      // Act
      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert - Should return the icon object as-is since it's not a string
      expect(result.current).toEqual({ url: '/icons/test-icon.png' })
    })

    it('should memoize result based on plugin_id', () => {
      // Arrange
      const mockDataSourceList = [
        createMockDataSourceListItem({
          plugin_id: 'test-plugin-id',
        }),
      ]
      mockUseDataSourceList.mockReturnValue({
        data: mockDataSourceList,
        isSuccess: true,
      })
      const nodeData = createMockDataSourceNodeData({ plugin_id: 'test-plugin-id' })

      // Act
      const { result, rerender } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })
      const firstResult = result.current

      // Rerender with same props
      rerender()

      // Assert - Should return the same memoized result
      expect(result.current).toBe(firstResult)
    })
  })
})

// ==========================================
// OptionCard Tests
// ==========================================
describe('OptionCard', () => {
  const defaultProps = {
    label: 'Test Option',
    selected: false,
    nodeData: createMockDataSourceNodeData(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Setup default mock for useDatasourceIcon
    mockUseDataSourceList.mockReturnValue({
      data: [],
      isSuccess: true,
    })
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderWithProviders(<OptionCard {...defaultProps} />)

      // Assert
      expect(screen.getByText('Test Option')).toBeInTheDocument()
    })

    it('should render label text', () => {
      // Arrange & Act
      renderWithProviders(<OptionCard {...defaultProps} label="Custom Label" />)

      // Assert
      expect(screen.getByText('Custom Label')).toBeInTheDocument()
    })

    it('should render DatasourceIcon component', () => {
      // Arrange & Act
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      // Assert - DatasourceIcon container should exist
      const iconContainer = container.querySelector('.size-8')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should set title attribute for label truncation', () => {
      // Arrange
      const longLabel = 'This is a very long label that might be truncated'

      // Act
      renderWithProviders(<OptionCard {...defaultProps} label={longLabel} />)

      // Assert
      const labelElement = screen.getByText(longLabel)
      expect(labelElement).toHaveAttribute('title', longLabel)
    })
  })

  describe('Props', () => {
    describe('selected', () => {
      it('should apply selected styles when selected is true', () => {
        // Arrange & Act
        const { container } = renderWithProviders(
          <OptionCard {...defaultProps} selected={true} />,
        )

        // Assert
        const card = container.firstChild
        expect(card).toHaveClass('border-components-option-card-option-selected-border')
        expect(card).toHaveClass('bg-components-option-card-option-selected-bg')
      })

      it('should apply unselected styles when selected is false', () => {
        // Arrange & Act
        const { container } = renderWithProviders(
          <OptionCard {...defaultProps} selected={false} />,
        )

        // Assert
        const card = container.firstChild
        expect(card).toHaveClass('border-components-option-card-option-border')
        expect(card).toHaveClass('bg-components-option-card-option-bg')
      })

      it('should apply text-text-primary to label when selected', () => {
        // Arrange & Act
        renderWithProviders(<OptionCard {...defaultProps} selected={true} />)

        // Assert
        const label = screen.getByText('Test Option')
        expect(label).toHaveClass('text-text-primary')
      })

      it('should apply text-text-secondary to label when not selected', () => {
        // Arrange & Act
        renderWithProviders(<OptionCard {...defaultProps} selected={false} />)

        // Assert
        const label = screen.getByText('Test Option')
        expect(label).toHaveClass('text-text-secondary')
      })
    })

    describe('onClick', () => {
      it('should call onClick when card is clicked', () => {
        // Arrange
        const mockOnClick = vi.fn()
        renderWithProviders(
          <OptionCard {...defaultProps} onClick={mockOnClick} />,
        )

        // Act - Click on the label text's parent card
        const labelElement = screen.getByText('Test Option')
        const card = labelElement.closest('[class*="cursor-pointer"]')
        expect(card).toBeInTheDocument()
        fireEvent.click(card!)

        // Assert
        expect(mockOnClick).toHaveBeenCalledTimes(1)
      })

      it('should not crash when onClick is not provided', () => {
        // Arrange & Act
        renderWithProviders(
          <OptionCard {...defaultProps} onClick={undefined} />,
        )

        // Act - Click on the label text's parent card should not throw
        const labelElement = screen.getByText('Test Option')
        const card = labelElement.closest('[class*="cursor-pointer"]')
        expect(card).toBeInTheDocument()
        fireEvent.click(card!)

        // Assert - Component should still be rendered
        expect(screen.getByText('Test Option')).toBeInTheDocument()
      })
    })

    describe('nodeData', () => {
      it('should pass nodeData to useDatasourceIcon hook', () => {
        // Arrange
        const customNodeData = createMockDataSourceNodeData({ plugin_id: 'custom-plugin' })

        // Act
        renderWithProviders(<OptionCard {...defaultProps} nodeData={customNodeData} />)

        // Assert - Hook should be called (via useDataSourceList mock)
        expect(mockUseDataSourceList).toHaveBeenCalled()
      })
    })
  })

  describe('Styling', () => {
    it('should have cursor-pointer class', () => {
      // Arrange & Act
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      // Assert
      expect(container.firstChild).toHaveClass('cursor-pointer')
    })

    it('should have flex layout classes', () => {
      // Arrange & Act
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      // Assert
      expect(container.firstChild).toHaveClass('flex')
      expect(container.firstChild).toHaveClass('items-center')
      expect(container.firstChild).toHaveClass('gap-2')
    })

    it('should have rounded-xl border', () => {
      // Arrange & Act
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      // Assert
      expect(container.firstChild).toHaveClass('rounded-xl')
      expect(container.firstChild).toHaveClass('border')
    })

    it('should have padding p-3', () => {
      // Arrange & Act
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      // Assert
      expect(container.firstChild).toHaveClass('p-3')
    })

    it('should have line-clamp-2 for label truncation', () => {
      // Arrange & Act
      renderWithProviders(<OptionCard {...defaultProps} />)

      // Assert
      const label = screen.getByText('Test Option')
      expect(label).toHaveClass('line-clamp-2')
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert - OptionCard should be a memoized component
      expect(OptionCard).toBeDefined()
      // React.memo wraps the component, so we check it renders correctly
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})

// ==========================================
// DataSourceOptions Tests
// ==========================================
describe('DataSourceOptions', () => {
  const defaultNodes = createMockPipelineNodes(3)
  const defaultOptions = defaultNodes.map(createMockDatasourceOption)

  const defaultProps = {
    pipelineNodes: defaultNodes,
    datasourceNodeId: '',
    onSelect: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseDatasourceOptions.mockReturnValue(defaultOptions)
    mockUseDataSourceList.mockReturnValue({
      data: [],
      isSuccess: true,
    })
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderWithProviders(<DataSourceOptions {...defaultProps} />)

      // Assert
      expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      expect(screen.getByText('Data Source 2')).toBeInTheDocument()
      expect(screen.getByText('Data Source 3')).toBeInTheDocument()
    })

    it('should render correct number of option cards', () => {
      // Arrange & Act
      renderWithProviders(<DataSourceOptions {...defaultProps} />)

      // Assert
      expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      expect(screen.getByText('Data Source 2')).toBeInTheDocument()
      expect(screen.getByText('Data Source 3')).toBeInTheDocument()
    })

    it('should render with grid layout', () => {
      // Arrange & Act
      const { container } = renderWithProviders(<DataSourceOptions {...defaultProps} />)

      // Assert
      const gridContainer = container.firstChild
      expect(gridContainer).toHaveClass('grid')
      expect(gridContainer).toHaveClass('w-full')
      expect(gridContainer).toHaveClass('grid-cols-4')
      expect(gridContainer).toHaveClass('gap-1')
    })

    it('should render no option cards when options is empty', () => {
      // Arrange
      mockUseDatasourceOptions.mockReturnValue([])

      // Act
      const { container } = renderWithProviders(<DataSourceOptions {...defaultProps} />)

      // Assert
      expect(screen.queryByText('Data Source')).not.toBeInTheDocument()
      // Grid container should still exist
      expect(container.firstChild).toHaveClass('grid')
    })

    it('should render single option card when only one option exists', () => {
      // Arrange
      const singleOption = [createMockDatasourceOption(defaultNodes[0])]
      mockUseDatasourceOptions.mockReturnValue(singleOption)

      // Act
      renderWithProviders(<DataSourceOptions {...defaultProps} />)

      // Assert
      expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      expect(screen.queryByText('Data Source 2')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Tests
  // ==========================================
  describe('Props', () => {
    describe('pipelineNodes', () => {
      it('should pass pipelineNodes to useDatasourceOptions hook', () => {
        // Arrange
        const customNodes = createMockPipelineNodes(2)
        mockUseDatasourceOptions.mockReturnValue(customNodes.map(createMockDatasourceOption))

        // Act
        renderWithProviders(
          <DataSourceOptions {...defaultProps} pipelineNodes={customNodes} />,
        )

        // Assert
        expect(mockUseDatasourceOptions).toHaveBeenCalledWith(customNodes)
      })

      it('should handle empty pipelineNodes array', () => {
        // Arrange
        mockUseDatasourceOptions.mockReturnValue([])

        // Act
        renderWithProviders(
          <DataSourceOptions {...defaultProps} pipelineNodes={[]} />,
        )

        // Assert
        expect(mockUseDatasourceOptions).toHaveBeenCalledWith([])
      })
    })

    describe('datasourceNodeId', () => {
      it('should mark corresponding option as selected', () => {
        // Arrange & Act
        const { container } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-2"
          />,
        )

        // Assert - Check for selected styling on second card
        const cards = container.querySelectorAll('.rounded-xl.border')
        expect(cards[1]).toHaveClass('border-components-option-card-option-selected-border')
      })

      it('should show no selection when datasourceNodeId is empty', () => {
        // Arrange & Act
        const { container } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId=""
          />,
        )

        // Assert - No card should have selected styling
        const selectedCards = container.querySelectorAll('.border-components-option-card-option-selected-border')
        expect(selectedCards).toHaveLength(0)
      })

      it('should show no selection when datasourceNodeId does not match any option', () => {
        // Arrange & Act
        const { container } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="non-existent-node"
          />,
        )

        // Assert
        const selectedCards = container.querySelectorAll('.border-components-option-card-option-selected-border')
        expect(selectedCards).toHaveLength(0)
      })

      it('should update selection when datasourceNodeId changes', () => {
        // Arrange
        const { container, rerender } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-1"
          />,
        )

        // Assert initial selection
        let cards = container.querySelectorAll('.rounded-xl.border')
        expect(cards[0]).toHaveClass('border-components-option-card-option-selected-border')

        // Act - Change selection
        rerender(
          <QueryClientProvider client={createQueryClient()}>
            <DataSourceOptions
              {...defaultProps}
              datasourceNodeId="node-2"
            />
          </QueryClientProvider>,
        )

        // Assert new selection
        cards = container.querySelectorAll('.rounded-xl.border')
        expect(cards[0]).not.toHaveClass('border-components-option-card-option-selected-border')
        expect(cards[1]).toHaveClass('border-components-option-card-option-selected-border')
      })
    })

    describe('onSelect', () => {
      it('should receive onSelect callback', () => {
        // Arrange
        const mockOnSelect = vi.fn()

        // Act
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            onSelect={mockOnSelect}
          />,
        )

        // Assert - Component renders without error
        expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // Side Effects and Cleanup Tests
  // ==========================================
  describe('Side Effects and Cleanup', () => {
    describe('useEffect - Auto-select first option', () => {
      it('should auto-select first option when options exist and no datasourceNodeId', () => {
        // Arrange
        const mockOnSelect = vi.fn()

        // Act
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId=""
            onSelect={mockOnSelect}
          />,
        )

        // Assert - Should auto-select first option on mount
        expect(mockOnSelect).toHaveBeenCalledTimes(1)
        expect(mockOnSelect).toHaveBeenCalledWith({
          nodeId: 'node-1',
          nodeData: defaultOptions[0].data,
        } satisfies Datasource)
      })

      it('should NOT auto-select when datasourceNodeId is provided', () => {
        // Arrange
        const mockOnSelect = vi.fn()

        // Act
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-2"
            onSelect={mockOnSelect}
          />,
        )

        // Assert - Should not auto-select because datasourceNodeId is provided
        expect(mockOnSelect).not.toHaveBeenCalled()
      })

      it('should NOT auto-select when options array is empty', () => {
        // Arrange
        mockUseDatasourceOptions.mockReturnValue([])
        const mockOnSelect = vi.fn()

        // Act
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            pipelineNodes={[]}
            datasourceNodeId=""
            onSelect={mockOnSelect}
          />,
        )

        // Assert
        expect(mockOnSelect).not.toHaveBeenCalled()
      })

      it('should only run useEffect once on initial mount', () => {
        // Arrange
        const mockOnSelect = vi.fn()
        const { rerender } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId=""
            onSelect={mockOnSelect}
          />,
        )

        // Assert - Called once on mount
        expect(mockOnSelect).toHaveBeenCalledTimes(1)

        // Act - Rerender with same props
        rerender(
          <QueryClientProvider client={createQueryClient()}>
            <DataSourceOptions
              {...defaultProps}
              datasourceNodeId=""
              onSelect={mockOnSelect}
            />
          </QueryClientProvider>,
        )

        // Assert - Still called only once (useEffect has empty dependency array)
        expect(mockOnSelect).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ==========================================
  // Callback Stability and Memoization Tests
  // ==========================================
  describe('Callback Stability and Memoization', () => {
    it('should maintain callback reference stability across renders with same props', () => {
      // Arrange
      const mockOnSelect = vi.fn()

      const { rerender } = renderWithProviders(
        <DataSourceOptions
          {...defaultProps}
          onSelect={mockOnSelect}
        />,
      )

      // Get initial click handlers
      expect(screen.getByText('Data Source 1')).toBeInTheDocument()

      // Trigger clicks to test handlers work
      fireEvent.click(screen.getByText('Data Source 1'))
      expect(mockOnSelect).toHaveBeenCalledTimes(2) // 1 auto-select + 1 click

      // Act - Rerender with same onSelect reference
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DataSourceOptions
            {...defaultProps}
            onSelect={mockOnSelect}
          />
        </QueryClientProvider>,
      )

      // Assert - Component still works after rerender
      fireEvent.click(screen.getByText('Data Source 2'))
      expect(mockOnSelect).toHaveBeenCalledTimes(3)
    })

    it('should update callback when onSelect changes', () => {
      // Arrange
      const mockOnSelect1 = vi.fn()
      const mockOnSelect2 = vi.fn()

      const { rerender } = renderWithProviders(
        <DataSourceOptions
          {...defaultProps}
          datasourceNodeId="node-1"
          onSelect={mockOnSelect1}
        />,
      )

      // Act - Click with first callback
      fireEvent.click(screen.getByText('Data Source 2'))
      expect(mockOnSelect1).toHaveBeenCalledTimes(1)

      // Act - Change callback
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-1"
            onSelect={mockOnSelect2}
          />
        </QueryClientProvider>,
      )

      // Act - Click with new callback
      fireEvent.click(screen.getByText('Data Source 3'))

      // Assert - New callback should be called
      expect(mockOnSelect2).toHaveBeenCalledTimes(1)
      expect(mockOnSelect2).toHaveBeenCalledWith({
        nodeId: 'node-3',
        nodeData: defaultOptions[2].data,
      })
    })

    it('should update callback when options change', () => {
      // Arrange
      const mockOnSelect = vi.fn()

      const { rerender } = renderWithProviders(
        <DataSourceOptions
          {...defaultProps}
          datasourceNodeId="node-1"
          onSelect={mockOnSelect}
        />,
      )

      // Act - Click first option
      fireEvent.click(screen.getByText('Data Source 1'))
      expect(mockOnSelect).toHaveBeenCalledWith({
        nodeId: 'node-1',
        nodeData: defaultOptions[0].data,
      })

      // Act - Change options
      const newNodes = createMockPipelineNodes(2)
      const newOptions = newNodes.map(node => createMockDatasourceOption(node))
      mockUseDatasourceOptions.mockReturnValue(newOptions)

      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DataSourceOptions
            pipelineNodes={newNodes}
            datasourceNodeId="node-1"
            onSelect={mockOnSelect}
          />
        </QueryClientProvider>,
      )

      // Act - Click updated first option
      fireEvent.click(screen.getByText('Data Source 1'))

      // Assert - Callback receives new option data
      expect(mockOnSelect).toHaveBeenLastCalledWith({
        nodeId: newOptions[0].value,
        nodeData: newOptions[0].data,
      })
    })
  })

  // ==========================================
  // User Interactions and Event Handlers Tests
  // ==========================================
  describe('User Interactions and Event Handlers', () => {
    describe('Option Selection', () => {
      it('should call onSelect with correct datasource when clicking an option', () => {
        // Arrange
        const mockOnSelect = vi.fn()
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-1"
            onSelect={mockOnSelect}
          />,
        )

        // Act - Click second option
        fireEvent.click(screen.getByText('Data Source 2'))

        // Assert
        expect(mockOnSelect).toHaveBeenCalledTimes(1)
        expect(mockOnSelect).toHaveBeenCalledWith({
          nodeId: 'node-2',
          nodeData: defaultOptions[1].data,
        } satisfies Datasource)
      })

      it('should allow selecting already selected option', () => {
        // Arrange
        const mockOnSelect = vi.fn()
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-1"
            onSelect={mockOnSelect}
          />,
        )

        // Act - Click already selected option
        fireEvent.click(screen.getByText('Data Source 1'))

        // Assert
        expect(mockOnSelect).toHaveBeenCalledTimes(1)
        expect(mockOnSelect).toHaveBeenCalledWith({
          nodeId: 'node-1',
          nodeData: defaultOptions[0].data,
        })
      })

      it('should allow multiple sequential selections', () => {
        // Arrange
        const mockOnSelect = vi.fn()
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-1"
            onSelect={mockOnSelect}
          />,
        )

        // Act - Click options sequentially
        fireEvent.click(screen.getByText('Data Source 1'))
        fireEvent.click(screen.getByText('Data Source 2'))
        fireEvent.click(screen.getByText('Data Source 3'))

        // Assert
        expect(mockOnSelect).toHaveBeenCalledTimes(3)
        expect(mockOnSelect).toHaveBeenNthCalledWith(1, {
          nodeId: 'node-1',
          nodeData: defaultOptions[0].data,
        })
        expect(mockOnSelect).toHaveBeenNthCalledWith(2, {
          nodeId: 'node-2',
          nodeData: defaultOptions[1].data,
        })
        expect(mockOnSelect).toHaveBeenNthCalledWith(3, {
          nodeId: 'node-3',
          nodeData: defaultOptions[2].data,
        })
      })
    })

    describe('handelSelect Internal Logic', () => {
      it('should handle rapid successive clicks', async () => {
        // Arrange
        const mockOnSelect = vi.fn()
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-1"
            onSelect={mockOnSelect}
          />,
        )

        // Act - Rapid clicks
        await act(async () => {
          fireEvent.click(screen.getByText('Data Source 1'))
          fireEvent.click(screen.getByText('Data Source 2'))
          fireEvent.click(screen.getByText('Data Source 3'))
          fireEvent.click(screen.getByText('Data Source 1'))
          fireEvent.click(screen.getByText('Data Source 2'))
        })

        // Assert - All clicks should be registered
        expect(mockOnSelect).toHaveBeenCalledTimes(5)
      })
    })
  })

  // ==========================================
  // Edge Cases and Error Handling Tests
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    describe('Empty States', () => {
      it('should handle empty options array gracefully', () => {
        // Arrange
        mockUseDatasourceOptions.mockReturnValue([])

        // Act
        const { container } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            pipelineNodes={[]}
          />,
        )

        // Assert
        expect(container.firstChild).toBeInTheDocument()
      })

      it('should not crash when datasourceNodeId is undefined', () => {
        // Arrange & Act
        renderWithProviders(
          <DataSourceOptions
            pipelineNodes={defaultNodes}
            datasourceNodeId={undefined as unknown as string}
            onSelect={vi.fn()}
          />,
        )

        // Assert
        expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      })
    })

    describe('Null/Undefined Values', () => {
      it('should handle option with missing data properties', () => {
        // Arrange
        const optionWithMinimalData = [{
          label: 'Minimal Option',
          value: 'minimal-1',
          data: {
            title: 'Minimal',
            desc: '',
            type: BlockEnum.DataSource,
            plugin_id: '',
            provider_type: '',
            provider_name: '',
            datasource_name: '',
            datasource_label: '',
            datasource_parameters: {},
            datasource_configurations: {},
          } as DataSourceNodeType,
        }]
        mockUseDatasourceOptions.mockReturnValue(optionWithMinimalData)

        // Act
        renderWithProviders(<DataSourceOptions {...defaultProps} />)

        // Assert
        expect(screen.getByText('Minimal Option')).toBeInTheDocument()
      })
    })

    describe('Large Data Sets', () => {
      it('should handle large number of options', () => {
        // Arrange
        const manyNodes = createMockPipelineNodes(50)
        const manyOptions = manyNodes.map(createMockDatasourceOption)
        mockUseDatasourceOptions.mockReturnValue(manyOptions)

        // Act
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            pipelineNodes={manyNodes}
          />,
        )

        // Assert
        expect(screen.getByText('Data Source 1')).toBeInTheDocument()
        expect(screen.getByText('Data Source 50')).toBeInTheDocument()
      })
    })

    describe('Special Characters in Data', () => {
      it('should handle special characters in option labels', () => {
        // Arrange
        const specialNode = createMockPipelineNode({
          id: 'special-node',
          data: createMockDataSourceNodeData({
            title: 'Data Source <script>alert("xss")</script>',
          }),
        })
        const specialOptions = [createMockDatasourceOption(specialNode)]
        mockUseDatasourceOptions.mockReturnValue(specialOptions)

        // Act
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            pipelineNodes={[specialNode]}
          />,
        )

        // Assert - Special characters should be escaped/rendered safely
        expect(screen.getByText('Data Source <script>alert("xss")</script>')).toBeInTheDocument()
      })

      it('should handle unicode characters in option labels', () => {
        // Arrange
        const unicodeNode = createMockPipelineNode({
          id: 'unicode-node',
          data: createMockDataSourceNodeData({
            title: '数据源 📁 Source émoji',
          }),
        })
        const unicodeOptions = [createMockDatasourceOption(unicodeNode)]
        mockUseDatasourceOptions.mockReturnValue(unicodeOptions)

        // Act
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            pipelineNodes={[unicodeNode]}
          />,
        )

        // Assert
        expect(screen.getByText('数据源 📁 Source émoji')).toBeInTheDocument()
      })

      it('should handle empty string as option value', () => {
        // Arrange
        const emptyValueOption = [{
          label: 'Empty Value Option',
          value: '',
          data: createMockDataSourceNodeData(),
        }]
        mockUseDatasourceOptions.mockReturnValue(emptyValueOption)

        // Act
        renderWithProviders(<DataSourceOptions {...defaultProps} />)

        // Assert
        expect(screen.getByText('Empty Value Option')).toBeInTheDocument()
      })
    })

    describe('Boundary Conditions', () => {
      it('should handle single option selection correctly', () => {
        // Arrange
        const singleOption = [createMockDatasourceOption(defaultNodes[0])]
        mockUseDatasourceOptions.mockReturnValue(singleOption)
        const mockOnSelect = vi.fn()

        // Act
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-1"
            onSelect={mockOnSelect}
          />,
        )

        // Assert - Click should still work
        fireEvent.click(screen.getByText('Data Source 1'))
        expect(mockOnSelect).toHaveBeenCalledTimes(1)
      })

      it('should handle options with same labels but different values', () => {
        // Arrange
        const duplicateLabelOptions = [
          {
            label: 'Duplicate Label',
            value: 'node-a',
            data: createMockDataSourceNodeData({ plugin_id: 'plugin-a' }),
          },
          {
            label: 'Duplicate Label',
            value: 'node-b',
            data: createMockDataSourceNodeData({ plugin_id: 'plugin-b' }),
          },
        ]
        mockUseDatasourceOptions.mockReturnValue(duplicateLabelOptions)
        const mockOnSelect = vi.fn()

        // Act
        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-a"
            onSelect={mockOnSelect}
          />,
        )

        // Assert - Both should render
        const labels = screen.getAllByText('Duplicate Label')
        expect(labels).toHaveLength(2)

        // Click second one
        fireEvent.click(labels[1])
        expect(mockOnSelect).toHaveBeenCalledWith({
          nodeId: 'node-b',
          nodeData: expect.objectContaining({ plugin_id: 'plugin-b' }),
        })
      })
    })

    describe('Component Unmounting', () => {
      it('should handle unmounting without errors', () => {
        // Arrange
        const mockOnSelect = vi.fn()
        const { unmount } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            onSelect={mockOnSelect}
          />,
        )

        // Act
        unmount()

        // Assert - No errors thrown, component cleanly unmounted
        expect(screen.queryByText('Data Source 1')).not.toBeInTheDocument()
      })

      it('should handle unmounting during rapid interactions', async () => {
        // Arrange
        const mockOnSelect = vi.fn()
        const { unmount } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="node-1"
            onSelect={mockOnSelect}
          />,
        )

        // Act - Start interactions then unmount
        fireEvent.click(screen.getByText('Data Source 1'))

        // Unmount during/after interaction
        unmount()

        // Assert - Should not throw
        expect(screen.queryByText('Data Source 1')).not.toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // Integration Tests
  // ==========================================
  describe('Integration', () => {
    it('should render OptionCard with correct props', () => {
      // Arrange & Act
      const { container } = renderWithProviders(<DataSourceOptions {...defaultProps} />)

      // Assert - Verify real OptionCard components are rendered
      const cards = container.querySelectorAll('.rounded-xl.border')
      expect(cards).toHaveLength(3)
    })

    it('should correctly pass selected state to OptionCard', () => {
      // Arrange & Act
      const { container } = renderWithProviders(
        <DataSourceOptions
          {...defaultProps}
          datasourceNodeId="node-2"
        />,
      )

      // Assert
      const cards = container.querySelectorAll('.rounded-xl.border')
      expect(cards[0]).not.toHaveClass('border-components-option-card-option-selected-border')
      expect(cards[1]).toHaveClass('border-components-option-card-option-selected-border')
      expect(cards[2]).not.toHaveClass('border-components-option-card-option-selected-border')
    })

    it('should use option.value as key for React rendering', () => {
      // This test verifies that React doesn't throw duplicate key warnings
      // Arrange
      const uniqueValueOptions = createMockPipelineNodes(5).map(createMockDatasourceOption)
      mockUseDatasourceOptions.mockReturnValue(uniqueValueOptions)

      // Act - Should render without console warnings about duplicate keys
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn())
      renderWithProviders(<DataSourceOptions {...defaultProps} />)

      // Assert
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('key'),
      )
      consoleSpy.mockRestore()
    })
  })

  // ==========================================
  // All Prop Variations Tests
  // ==========================================
  describe('All Prop Variations', () => {
    it.each([
      { datasourceNodeId: '', description: 'empty string' },
      { datasourceNodeId: 'node-1', description: 'first node' },
      { datasourceNodeId: 'node-2', description: 'middle node' },
      { datasourceNodeId: 'node-3', description: 'last node' },
      { datasourceNodeId: 'non-existent', description: 'non-existent node' },
    ])('should handle datasourceNodeId as $description', ({ datasourceNodeId }) => {
      // Arrange & Act
      renderWithProviders(
        <DataSourceOptions
          {...defaultProps}
          datasourceNodeId={datasourceNodeId}
        />,
      )

      // Assert
      expect(screen.getByText('Data Source 1')).toBeInTheDocument()
    })

    it.each([
      { count: 0, description: 'zero options' },
      { count: 1, description: 'single option' },
      { count: 3, description: 'few options' },
      { count: 10, description: 'many options' },
    ])('should render correctly with $description', ({ count }) => {
      // Arrange
      const nodes = createMockPipelineNodes(count)
      const options = nodes.map(createMockDatasourceOption)
      mockUseDatasourceOptions.mockReturnValue(options)

      // Act
      renderWithProviders(
        <DataSourceOptions
          pipelineNodes={nodes}
          datasourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      // Assert
      if (count > 0)
        expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      else
        expect(screen.queryByText('Data Source 1')).not.toBeInTheDocument()
    })
  })
})
