import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import DatasourceIcon from '../datasource-icon'
import { useDatasourceIcon } from '../hooks'
import DataSourceOptions from '../index'
import OptionCard from '../option-card'

// Mock useDatasourceOptions hook from parent hooks
const mockUseDatasourceOptions = vi.fn()
vi.mock('../../hooks', () => ({
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

// DatasourceIcon Tests
describe('DatasourceIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render icon with background image', () => {
      const iconUrl = 'https://example.com/icon.png'

      const { container } = render(<DatasourceIcon iconUrl={iconUrl} />)

      const iconDiv = container.querySelector('[style*="background-image"]')
      expect(iconDiv).toHaveStyle({ backgroundImage: `url(${iconUrl})` })
    })

    it('should render with default size (sm)', () => {
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      // Assert - Default size is 'sm' which maps to 'w-5 h-5'
      expect(container.firstChild).toHaveClass('w-5')
      expect(container.firstChild).toHaveClass('h-5')
    })
  })

  describe('Props', () => {
    describe('size', () => {
      it('should render with xs size', () => {
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" size="xs" />,
        )

        expect(container.firstChild).toHaveClass('w-4')
        expect(container.firstChild).toHaveClass('h-4')
        expect(container.firstChild).toHaveClass('rounded-[5px]')
      })

      it('should render with sm size', () => {
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" size="sm" />,
        )

        expect(container.firstChild).toHaveClass('w-5')
        expect(container.firstChild).toHaveClass('h-5')
        expect(container.firstChild).toHaveClass('rounded-md')
      })

      it('should render with md size', () => {
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" size="md" />,
        )

        expect(container.firstChild).toHaveClass('w-6')
        expect(container.firstChild).toHaveClass('h-6')
        expect(container.firstChild).toHaveClass('rounded-lg')
      })
    })

    describe('className', () => {
      it('should apply custom className', () => {
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" className="custom-class" />,
        )

        expect(container.firstChild).toHaveClass('custom-class')
      })

      it('should merge custom className with default classes', () => {
        const { container } = render(
          <DatasourceIcon iconUrl="https://example.com/icon.png" className="custom-class" size="sm" />,
        )

        expect(container.firstChild).toHaveClass('custom-class')
        expect(container.firstChild).toHaveClass('w-5')
        expect(container.firstChild).toHaveClass('h-5')
      })
    })

    describe('iconUrl', () => {
      it('should handle empty iconUrl', () => {
        const { container } = render(<DatasourceIcon iconUrl="" />)

        const iconDiv = container.querySelector('[style*="background-image"]')
        expect(iconDiv).toHaveStyle({ backgroundImage: 'url()' })
      })

      it('should handle special characters in iconUrl', () => {
        const iconUrl = 'https://example.com/icon.png?param=value&other=123'

        const { container } = render(<DatasourceIcon iconUrl={iconUrl} />)

        const iconDiv = container.querySelector('[style*="background-image"]')
        expect(iconDiv).toHaveStyle({ backgroundImage: `url(${iconUrl})` })
      })

      it('should handle data URL as iconUrl', () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

        const { container } = render(<DatasourceIcon iconUrl={dataUrl} />)

        const iconDiv = container.querySelector('[style*="background-image"]')
        expect(iconDiv).toBeInTheDocument()
      })
    })
  })

  describe('Styling', () => {
    it('should have flex container classes', () => {
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      expect(container.firstChild).toHaveClass('flex')
      expect(container.firstChild).toHaveClass('items-center')
      expect(container.firstChild).toHaveClass('justify-center')
    })

    it('should have shadow-xs class from size map', () => {
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      // Assert - Default size 'sm' has shadow-xs
      expect(container.firstChild).toHaveClass('shadow-xs')
    })

    it('should have inner div with bg-cover class', () => {
      const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)

      const innerDiv = container.querySelector('.bg-cover')
      expect(innerDiv).toBeInTheDocument()
      expect(innerDiv).toHaveClass('bg-center')
      expect(innerDiv).toHaveClass('rounded-md')
    })
  })
})

// useDatasourceIcon Hook Tests
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
      mockUseDataSourceList.mockReturnValue({
        data: undefined,
        isSuccess: false,
      })
      const nodeData = createMockDataSourceNodeData()

      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      expect(result.current).toBeUndefined()
    })

    it('should call useDataSourceList with true', () => {
      const nodeData = createMockDataSourceNodeData()

      renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      expect(mockUseDataSourceList).toHaveBeenCalledWith(true)
    })
  })

  describe('Success State', () => {
    it('should return icon when data is loaded and plugin matches', () => {
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

      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert - Icon should have basePath prepended
      expect(result.current).toBe('/mock-base-path/icons/test-icon.png')
    })

    it('should return undefined when plugin does not match', () => {
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

      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      expect(result.current).toBeUndefined()
    })

    it('should prepend basePath to icon when icon does not include basePath', () => {
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

      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert - Icon should have basePath prepended
      expect(result.current).toBe('/mock-base-path/icons/test-icon.png')
    })

    it('should not prepend basePath when icon already includes basePath', () => {
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

      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert - Icon should not be modified
      expect(result.current).toBe('/mock-base-path/icons/test-icon.png')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty dataSourceList', () => {
      mockUseDataSourceList.mockReturnValue({
        data: [],
        isSuccess: true,
      })
      const nodeData = createMockDataSourceNodeData()

      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      expect(result.current).toBeUndefined()
    })

    it('should handle null dataSourceList', () => {
      mockUseDataSourceList.mockReturnValue({
        data: null,
        isSuccess: true,
      })
      const nodeData = createMockDataSourceNodeData()

      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      expect(result.current).toBeUndefined()
    })

    it('should handle icon as non-string type', () => {
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

      const { result } = renderHook(() => useDatasourceIcon(nodeData), {
        wrapper: createHookWrapper(),
      })

      // Assert - Should return the icon object as-is since it's not a string
      expect(result.current).toEqual({ url: '/icons/test-icon.png' })
    })

    it('should memoize result based on plugin_id', () => {
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

// OptionCard Tests
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
      renderWithProviders(<OptionCard {...defaultProps} />)

      expect(screen.getByText('Test Option')).toBeInTheDocument()
    })

    it('should render label text', () => {
      renderWithProviders(<OptionCard {...defaultProps} label="Custom Label" />)

      expect(screen.getByText('Custom Label')).toBeInTheDocument()
    })

    it('should render DatasourceIcon component', () => {
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      // Assert - DatasourceIcon container should exist
      const iconContainer = container.querySelector('.size-8')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should set title attribute for label truncation', () => {
      const longLabel = 'This is a very long label that might be truncated'

      renderWithProviders(<OptionCard {...defaultProps} label={longLabel} />)

      const labelElement = screen.getByText(longLabel)
      expect(labelElement).toHaveAttribute('title', longLabel)
    })
  })

  describe('Props', () => {
    describe('selected', () => {
      it('should apply selected styles when selected is true', () => {
        const { container } = renderWithProviders(
          <OptionCard {...defaultProps} selected={true} />,
        )

        const card = container.firstChild
        expect(card).toHaveClass('border-components-option-card-option-selected-border')
        expect(card).toHaveClass('bg-components-option-card-option-selected-bg')
      })

      it('should apply unselected styles when selected is false', () => {
        const { container } = renderWithProviders(
          <OptionCard {...defaultProps} selected={false} />,
        )

        const card = container.firstChild
        expect(card).toHaveClass('border-components-option-card-option-border')
        expect(card).toHaveClass('bg-components-option-card-option-bg')
      })

      it('should apply text-text-primary to label when selected', () => {
        renderWithProviders(<OptionCard {...defaultProps} selected={true} />)

        const label = screen.getByText('Test Option')
        expect(label).toHaveClass('text-text-primary')
      })

      it('should apply text-text-secondary to label when not selected', () => {
        renderWithProviders(<OptionCard {...defaultProps} selected={false} />)

        const label = screen.getByText('Test Option')
        expect(label).toHaveClass('text-text-secondary')
      })
    })

    describe('onClick', () => {
      it('should call onClick when card is clicked', () => {
        const mockOnClick = vi.fn()
        renderWithProviders(
          <OptionCard {...defaultProps} onClick={mockOnClick} />,
        )

        // Act - Click on the label text's parent card
        const labelElement = screen.getByText('Test Option')
        const card = labelElement.closest('[class*="cursor-pointer"]')
        expect(card).toBeInTheDocument()
        fireEvent.click(card!)

        expect(mockOnClick).toHaveBeenCalledTimes(1)
      })

      it('should not crash when onClick is not provided', () => {
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
        const customNodeData = createMockDataSourceNodeData({ plugin_id: 'custom-plugin' })

        renderWithProviders(<OptionCard {...defaultProps} nodeData={customNodeData} />)

        // Assert - Hook should be called (via useDataSourceList mock)
        expect(mockUseDataSourceList).toHaveBeenCalled()
      })
    })
  })

  describe('Styling', () => {
    it('should have cursor-pointer class', () => {
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      expect(container.firstChild).toHaveClass('cursor-pointer')
    })

    it('should have flex layout classes', () => {
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      expect(container.firstChild).toHaveClass('flex')
      expect(container.firstChild).toHaveClass('items-center')
      expect(container.firstChild).toHaveClass('gap-2')
    })

    it('should have rounded-xl border', () => {
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      expect(container.firstChild).toHaveClass('rounded-xl')
      expect(container.firstChild).toHaveClass('border')
    })

    it('should have padding p-3', () => {
      const { container } = renderWithProviders(<OptionCard {...defaultProps} />)

      expect(container.firstChild).toHaveClass('p-3')
    })

    it('should have line-clamp-2 for label truncation', () => {
      renderWithProviders(<OptionCard {...defaultProps} />)

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

// DataSourceOptions Tests
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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderWithProviders(<DataSourceOptions {...defaultProps} />)

      expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      expect(screen.getByText('Data Source 2')).toBeInTheDocument()
      expect(screen.getByText('Data Source 3')).toBeInTheDocument()
    })

    it('should render correct number of option cards', () => {
      renderWithProviders(<DataSourceOptions {...defaultProps} />)

      expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      expect(screen.getByText('Data Source 2')).toBeInTheDocument()
      expect(screen.getByText('Data Source 3')).toBeInTheDocument()
    })

    it('should render with grid layout', () => {
      const { container } = renderWithProviders(<DataSourceOptions {...defaultProps} />)

      const gridContainer = container.firstChild
      expect(gridContainer).toHaveClass('grid')
      expect(gridContainer).toHaveClass('w-full')
      expect(gridContainer).toHaveClass('grid-cols-4')
      expect(gridContainer).toHaveClass('gap-1')
    })

    it('should render no option cards when options is empty', () => {
      mockUseDatasourceOptions.mockReturnValue([])

      const { container } = renderWithProviders(<DataSourceOptions {...defaultProps} />)

      expect(screen.queryByText('Data Source')).not.toBeInTheDocument()
      // Grid container should still exist
      expect(container.firstChild).toHaveClass('grid')
    })

    it('should render single option card when only one option exists', () => {
      const singleOption = [createMockDatasourceOption(defaultNodes[0])]
      mockUseDatasourceOptions.mockReturnValue(singleOption)

      renderWithProviders(<DataSourceOptions {...defaultProps} />)

      expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      expect(screen.queryByText('Data Source 2')).not.toBeInTheDocument()
    })
  })

  // Props Tests
  describe('Props', () => {
    describe('pipelineNodes', () => {
      it('should pass pipelineNodes to useDatasourceOptions hook', () => {
        const customNodes = createMockPipelineNodes(2)
        mockUseDatasourceOptions.mockReturnValue(customNodes.map(createMockDatasourceOption))

        renderWithProviders(
          <DataSourceOptions {...defaultProps} pipelineNodes={customNodes} />,
        )

        expect(mockUseDatasourceOptions).toHaveBeenCalledWith(customNodes)
      })

      it('should handle empty pipelineNodes array', () => {
        mockUseDatasourceOptions.mockReturnValue([])

        renderWithProviders(
          <DataSourceOptions {...defaultProps} pipelineNodes={[]} />,
        )

        expect(mockUseDatasourceOptions).toHaveBeenCalledWith([])
      })
    })

    describe('datasourceNodeId', () => {
      it('should mark corresponding option as selected', () => {
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
        const { container } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            datasourceNodeId="non-existent-node"
          />,
        )

        const selectedCards = container.querySelectorAll('.border-components-option-card-option-selected-border')
        expect(selectedCards).toHaveLength(0)
      })

      it('should update selection when datasourceNodeId changes', () => {
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
        const mockOnSelect = vi.fn()

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

  // Side Effects and Cleanup Tests
  describe('Side Effects and Cleanup', () => {
    describe('useEffect - Auto-select first option', () => {
      it('should auto-select first option when options exist and no datasourceNodeId', () => {
        const mockOnSelect = vi.fn()

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
        const mockOnSelect = vi.fn()

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
        mockUseDatasourceOptions.mockReturnValue([])
        const mockOnSelect = vi.fn()

        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            pipelineNodes={[]}
            datasourceNodeId=""
            onSelect={mockOnSelect}
          />,
        )

        expect(mockOnSelect).not.toHaveBeenCalled()
      })

      it('should only run useEffect once on initial mount', () => {
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

  // Callback Stability and Memoization Tests
  describe('Callback Stability and Memoization', () => {
    it('should maintain callback reference stability across renders with same props', () => {
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

  // User Interactions and Event Handlers Tests
  describe('User Interactions and Event Handlers', () => {
    describe('Option Selection', () => {
      it('should call onSelect with correct datasource when clicking an option', () => {
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

        expect(mockOnSelect).toHaveBeenCalledTimes(1)
        expect(mockOnSelect).toHaveBeenCalledWith({
          nodeId: 'node-2',
          nodeData: defaultOptions[1].data,
        } satisfies Datasource)
      })

      it('should allow selecting already selected option', () => {
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

        expect(mockOnSelect).toHaveBeenCalledTimes(1)
        expect(mockOnSelect).toHaveBeenCalledWith({
          nodeId: 'node-1',
          nodeData: defaultOptions[0].data,
        })
      })

      it('should allow multiple sequential selections', () => {
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

  // Edge Cases and Error Handling Tests
  describe('Edge Cases and Error Handling', () => {
    describe('Empty States', () => {
      it('should handle empty options array gracefully', () => {
        mockUseDatasourceOptions.mockReturnValue([])

        const { container } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            pipelineNodes={[]}
          />,
        )

        expect(container.firstChild).toBeInTheDocument()
      })

      it('should not crash when datasourceNodeId is undefined', () => {
        renderWithProviders(
          <DataSourceOptions
            pipelineNodes={defaultNodes}
            datasourceNodeId={undefined as unknown as string}
            onSelect={vi.fn()}
          />,
        )

        expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      })
    })

    describe('Null/Undefined Values', () => {
      it('should handle option with missing data properties', () => {
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

        renderWithProviders(<DataSourceOptions {...defaultProps} />)

        expect(screen.getByText('Minimal Option')).toBeInTheDocument()
      })
    })

    describe('Large Data Sets', () => {
      it('should handle large number of options', () => {
        const manyNodes = createMockPipelineNodes(50)
        const manyOptions = manyNodes.map(createMockDatasourceOption)
        mockUseDatasourceOptions.mockReturnValue(manyOptions)

        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            pipelineNodes={manyNodes}
          />,
        )

        expect(screen.getByText('Data Source 1')).toBeInTheDocument()
        expect(screen.getByText('Data Source 50')).toBeInTheDocument()
      })
    })

    describe('Special Characters in Data', () => {
      it('should handle special characters in option labels', () => {
        const specialNode = createMockPipelineNode({
          id: 'special-node',
          data: createMockDataSourceNodeData({
            title: 'Data Source <script>alert("xss")</script>',
          }),
        })
        const specialOptions = [createMockDatasourceOption(specialNode)]
        mockUseDatasourceOptions.mockReturnValue(specialOptions)

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
        const unicodeNode = createMockPipelineNode({
          id: 'unicode-node',
          data: createMockDataSourceNodeData({
            title: '数据源 📁 Source émoji',
          }),
        })
        const unicodeOptions = [createMockDatasourceOption(unicodeNode)]
        mockUseDatasourceOptions.mockReturnValue(unicodeOptions)

        renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            pipelineNodes={[unicodeNode]}
          />,
        )

        expect(screen.getByText('数据源 📁 Source émoji')).toBeInTheDocument()
      })

      it('should handle empty string as option value', () => {
        const emptyValueOption = [{
          label: 'Empty Value Option',
          value: '',
          data: createMockDataSourceNodeData(),
        }]
        mockUseDatasourceOptions.mockReturnValue(emptyValueOption)

        renderWithProviders(<DataSourceOptions {...defaultProps} />)

        expect(screen.getByText('Empty Value Option')).toBeInTheDocument()
      })
    })

    describe('Boundary Conditions', () => {
      it('should handle single option selection correctly', () => {
        const singleOption = [createMockDatasourceOption(defaultNodes[0])]
        mockUseDatasourceOptions.mockReturnValue(singleOption)
        const mockOnSelect = vi.fn()

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

        fireEvent.click(labels[1])
        expect(mockOnSelect).toHaveBeenCalledWith({
          nodeId: 'node-b',
          nodeData: expect.objectContaining({ plugin_id: 'plugin-b' }),
        })
      })
    })

    describe('Component Unmounting', () => {
      it('should handle unmounting without errors', () => {
        const mockOnSelect = vi.fn()
        const { unmount } = renderWithProviders(
          <DataSourceOptions
            {...defaultProps}
            onSelect={mockOnSelect}
          />,
        )

        unmount()

        // Assert - No errors thrown, component cleanly unmounted
        expect(screen.queryByText('Data Source 1')).not.toBeInTheDocument()
      })

      it('should handle unmounting during rapid interactions', async () => {
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

  describe('Integration', () => {
    it('should render OptionCard with correct props', () => {
      const { container } = renderWithProviders(<DataSourceOptions {...defaultProps} />)

      // Assert - Verify real OptionCard components are rendered
      const cards = container.querySelectorAll('.rounded-xl.border')
      expect(cards).toHaveLength(3)
    })

    it('should correctly pass selected state to OptionCard', () => {
      const { container } = renderWithProviders(
        <DataSourceOptions
          {...defaultProps}
          datasourceNodeId="node-2"
        />,
      )

      const cards = container.querySelectorAll('.rounded-xl.border')
      expect(cards[0]).not.toHaveClass('border-components-option-card-option-selected-border')
      expect(cards[1]).toHaveClass('border-components-option-card-option-selected-border')
      expect(cards[2]).not.toHaveClass('border-components-option-card-option-selected-border')
    })

    it('should use option.value as key for React rendering', () => {
      // This test verifies that React doesn't throw duplicate key warnings
      const uniqueValueOptions = createMockPipelineNodes(5).map(createMockDatasourceOption)
      mockUseDatasourceOptions.mockReturnValue(uniqueValueOptions)

      // Act - Should render without console warnings about duplicate keys
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn())
      renderWithProviders(<DataSourceOptions {...defaultProps} />)

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('key'),
      )
      consoleSpy.mockRestore()
    })
  })

  describe('All Prop Variations', () => {
    it.each([
      { datasourceNodeId: '', description: 'empty string' },
      { datasourceNodeId: 'node-1', description: 'first node' },
      { datasourceNodeId: 'node-2', description: 'middle node' },
      { datasourceNodeId: 'node-3', description: 'last node' },
      { datasourceNodeId: 'non-existent', description: 'non-existent node' },
    ])('should handle datasourceNodeId as $description', ({ datasourceNodeId }) => {
      renderWithProviders(
        <DataSourceOptions
          {...defaultProps}
          datasourceNodeId={datasourceNodeId}
        />,
      )

      expect(screen.getByText('Data Source 1')).toBeInTheDocument()
    })

    it.each([
      { count: 0, description: 'zero options' },
      { count: 1, description: 'single option' },
      { count: 3, description: 'few options' },
      { count: 10, description: 'many options' },
    ])('should render correctly with $description', ({ count }) => {
      const nodes = createMockPipelineNodes(count)
      const options = nodes.map(createMockDatasourceOption)
      mockUseDatasourceOptions.mockReturnValue(options)

      renderWithProviders(
        <DataSourceOptions
          pipelineNodes={nodes}
          datasourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      if (count > 0)
        expect(screen.getByText('Data Source 1')).toBeInTheDocument()
      else
        expect(screen.queryByText('Data Source 1')).not.toBeInTheDocument()
    })
  })
})
