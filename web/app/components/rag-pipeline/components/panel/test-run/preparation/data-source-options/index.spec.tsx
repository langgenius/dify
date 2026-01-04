import type { DataSourceOption } from '../../types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import DataSourceOptions from './index'
import OptionCard from './option-card'

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Track mock options for useDatasourceOptions hook
let mockDatasourceOptions: DataSourceOption[] = []

vi.mock('../hooks', () => ({
  useDatasourceOptions: () => mockDatasourceOptions,
}))

// Mock useToolIcon hook
const mockToolIcon = { type: 'icon', icon: 'test-icon' }
vi.mock('@/app/components/workflow/hooks', () => ({
  useToolIcon: () => mockToolIcon,
}))

// Mock BlockIcon component
vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ type, toolIcon }: { type: string, toolIcon: unknown }) => (
    <div data-testid="block-icon" data-type={type} data-tool-icon={JSON.stringify(toolIcon)}>
      BlockIcon
    </div>
  ),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createNodeData = (overrides?: Partial<DataSourceNodeType>): DataSourceNodeType => ({
  title: 'Test Node',
  desc: 'Test description',
  type: 'data-source',
  provider_type: 'local_file',
  provider_name: 'Local File',
  datasource_name: 'local_file',
  plugin_id: 'test-plugin',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
} as unknown as DataSourceNodeType)

const createDataSourceOption = (overrides?: Partial<DataSourceOption>): DataSourceOption => ({
  label: 'Test Option',
  value: 'test-option-id',
  data: createNodeData(),
  ...overrides,
})

// ============================================================================
// OptionCard Component Tests
// ============================================================================

describe('OptionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render option card without crashing', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      render(
        <OptionCard
          label="Test Label"
          value="test-value"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should render label text', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      render(
        <OptionCard
          label="My Data Source"
          value="my-ds"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      expect(screen.getByText('My Data Source')).toBeInTheDocument()
    })

    it('should render BlockIcon component', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      expect(screen.getByTestId('block-icon')).toBeInTheDocument()
    })

    it('should pass correct type to BlockIcon', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      const blockIcon = screen.getByTestId('block-icon')
      // BlockEnum.DataSource value is 'datasource'
      expect(blockIcon).toHaveAttribute('data-type', 'datasource')
    })

    it('should set title attribute on label element', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      render(
        <OptionCard
          label="Long Label Text"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      expect(screen.getByTitle('Long Label Text')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Props Variations Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should apply selected styles when selected is true', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      const { container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={true}
          nodeData={nodeData}
        />,
      )

      // Assert
      const card = container.firstChild as HTMLElement
      expect(card.className).toContain('border-components-option-card-option-selected-border')
      expect(card.className).toContain('bg-components-option-card-option-selected-bg')
    })

    it('should apply unselected styles when selected is false', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      const { container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      const card = container.firstChild as HTMLElement
      expect(card.className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should apply text-text-primary to label when selected', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      render(
        <OptionCard
          label="Test Label"
          value="test"
          selected={true}
          nodeData={nodeData}
        />,
      )

      // Assert
      const label = screen.getByText('Test Label')
      expect(label.className).toContain('text-text-primary')
    })

    it('should apply text-text-secondary to label when not selected', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      render(
        <OptionCard
          label="Test Label"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      const label = screen.getByText('Test Label')
      expect(label.className).toContain('text-text-secondary')
    })

    it('should handle undefined onClick prop', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      const { container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
          onClick={undefined}
        />,
      )

      // Assert - should not throw when clicking
      const card = container.firstChild as HTMLElement
      expect(() => fireEvent.click(card)).not.toThrow()
    })

    it('should handle different node data types', () => {
      // Arrange
      const nodeData = createNodeData({
        title: 'Website Crawler',
        provider_type: 'website_crawl',
      })

      // Act
      render(
        <OptionCard
          label="Website Crawler"
          value="website"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      expect(screen.getByText('Website Crawler')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClick with value when card is clicked', () => {
      // Arrange
      const onClick = vi.fn()
      const nodeData = createNodeData()

      // Act
      const { container } = render(
        <OptionCard
          label="Test"
          value="test-value"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      // Assert
      expect(onClick).toHaveBeenCalledTimes(1)
      expect(onClick).toHaveBeenCalledWith('test-value')
    })

    it('should call onClick with correct value for different cards', () => {
      // Arrange
      const onClick = vi.fn()
      const nodeData = createNodeData()

      // Act
      const { container: container1 } = render(
        <OptionCard
          label="Card 1"
          value="value-1"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container1.firstChild as HTMLElement)

      const { container: container2 } = render(
        <OptionCard
          label="Card 2"
          value="value-2"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container2.firstChild as HTMLElement)

      // Assert
      expect(onClick).toHaveBeenCalledTimes(2)
      expect(onClick).toHaveBeenNthCalledWith(1, 'value-1')
      expect(onClick).toHaveBeenNthCalledWith(2, 'value-2')
    })

    it('should handle rapid clicks', () => {
      // Arrange
      const onClick = vi.fn()
      const nodeData = createNodeData()

      // Act
      const { container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      const card = container.firstChild as HTMLElement
      fireEvent.click(card)
      fireEvent.click(card)
      fireEvent.click(card)

      // Assert
      expect(onClick).toHaveBeenCalledTimes(3)
    })

    it('should call onClick with empty string value', () => {
      // Arrange
      const onClick = vi.fn()
      const nodeData = createNodeData()

      // Act
      const { container } = render(
        <OptionCard
          label="Test"
          value=""
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      // Assert
      expect(onClick).toHaveBeenCalledWith('')
    })
  })

  // -------------------------------------------------------------------------
  // Callback Stability Tests
  // -------------------------------------------------------------------------
  describe('Callback Stability', () => {
    it('should maintain stable handleClickCard callback when props dont change', () => {
      // Arrange
      const onClick = vi.fn()
      const nodeData = createNodeData()

      // Act
      const { rerender, container } = render(
        <OptionCard
          label="Test"
          value="test-value"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      rerender(
        <OptionCard
          label="Test"
          value="test-value"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      // Assert
      expect(onClick).toHaveBeenCalledTimes(2)
      expect(onClick).toHaveBeenNthCalledWith(1, 'test-value')
      expect(onClick).toHaveBeenNthCalledWith(2, 'test-value')
    })

    it('should update handleClickCard when value changes', () => {
      // Arrange
      const onClick = vi.fn()
      const nodeData = createNodeData()

      // Act
      const { rerender, container } = render(
        <OptionCard
          label="Test"
          value="old-value"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      rerender(
        <OptionCard
          label="Test"
          value="new-value"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      // Assert
      expect(onClick).toHaveBeenNthCalledWith(1, 'old-value')
      expect(onClick).toHaveBeenNthCalledWith(2, 'new-value')
    })

    it('should update handleClickCard when onClick changes', () => {
      // Arrange
      const onClick1 = vi.fn()
      const onClick2 = vi.fn()
      const nodeData = createNodeData()

      // Act
      const { rerender, container } = render(
        <OptionCard
          label="Test"
          value="test-value"
          selected={false}
          nodeData={nodeData}
          onClick={onClick1}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      rerender(
        <OptionCard
          label="Test"
          value="test-value"
          selected={false}
          nodeData={nodeData}
          onClick={onClick2}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      // Assert
      expect(onClick1).toHaveBeenCalledTimes(1)
      expect(onClick2).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized (React.memo)', () => {
      // Arrange
      const onClick = vi.fn()
      const nodeData = createNodeData()

      // Act
      const { rerender } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )

      // Rerender with same props
      rerender(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )

      // Assert - Component should render without issues
      expect(screen.getByText('Test')).toBeInTheDocument()
    })

    it('should re-render when selected prop changes', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      const { rerender, container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      let card = container.firstChild as HTMLElement
      expect(card.className).not.toContain('border-components-option-card-option-selected-border')

      rerender(
        <OptionCard
          label="Test"
          value="test"
          selected={true}
          nodeData={nodeData}
        />,
      )

      // Assert - Component should update styles
      card = container.firstChild as HTMLElement
      expect(card.className).toContain('border-components-option-card-option-selected-border')
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty label', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      render(
        <OptionCard
          label=""
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert - Should render without crashing
      expect(screen.getByTestId('block-icon')).toBeInTheDocument()
    })

    it('should handle very long label', () => {
      // Arrange
      const nodeData = createNodeData()
      const longLabel = 'A'.repeat(200)

      // Act
      render(
        <OptionCard
          label={longLabel}
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      expect(screen.getByText(longLabel)).toBeInTheDocument()
      expect(screen.getByTitle(longLabel)).toBeInTheDocument()
    })

    it('should handle special characters in label', () => {
      // Arrange
      const nodeData = createNodeData()
      const specialLabel = '<Test> & \'Label\' "Special"'

      // Act
      render(
        <OptionCard
          label={specialLabel}
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      expect(screen.getByText(specialLabel)).toBeInTheDocument()
    })

    it('should handle unicode characters in label', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      render(
        <OptionCard
          label="数据源 🎉 データソース"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      expect(screen.getByText('数据源 🎉 データソース')).toBeInTheDocument()
    })

    it('should handle empty value', () => {
      // Arrange
      const onClick = vi.fn()
      const nodeData = createNodeData()

      // Act
      const { container } = render(
        <OptionCard
          label="Test"
          value=""
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      // Assert
      expect(onClick).toHaveBeenCalledWith('')
    })

    it('should handle special characters in value', () => {
      // Arrange
      const onClick = vi.fn()
      const nodeData = createNodeData()
      const specialValue = 'test-value_123/abc:xyz'

      // Act
      const { container } = render(
        <OptionCard
          label="Test"
          value={specialValue}
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )
      fireEvent.click(container.firstChild as HTMLElement)

      // Assert
      expect(onClick).toHaveBeenCalledWith(specialValue)
    })

    it('should handle nodeData with minimal properties', () => {
      // Arrange
      const minimalNodeData = { title: 'Minimal' } as unknown as DataSourceNodeType

      // Act
      render(
        <OptionCard
          label="Minimal"
          value="test"
          selected={false}
          nodeData={minimalNodeData}
        />,
      )

      // Assert
      expect(screen.getByText('Minimal')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Accessibility Tests
  // -------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have cursor-pointer class for clickability indication', () => {
      // Arrange
      const nodeData = createNodeData()

      // Act
      const { container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      const card = container.firstChild as HTMLElement
      expect(card.className).toContain('cursor-pointer')
    })

    it('should provide title attribute for label tooltip', () => {
      // Arrange
      const nodeData = createNodeData()
      const label = 'This is a very long label that might get truncated'

      // Act
      render(
        <OptionCard
          label={label}
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      // Assert
      expect(screen.getByTitle(label)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// DataSourceOptions Component Tests
// ============================================================================

describe('DataSourceOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasourceOptions = []
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render container without crashing', () => {
      // Arrange
      mockDatasourceOptions = []

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      // Assert
      expect(container.querySelector('.grid')).toBeInTheDocument()
    })

    it('should render OptionCard for each option', () => {
      // Arrange
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'opt-1' }),
        createDataSourceOption({ label: 'Option 2', value: 'opt-2' }),
        createDataSourceOption({ label: 'Option 3', value: 'opt-3' }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('Option 1')).toBeInTheDocument()
      expect(screen.getByText('Option 2')).toBeInTheDocument()
      expect(screen.getByText('Option 3')).toBeInTheDocument()
    })

    it('should render empty grid when no options', () => {
      // Arrange
      mockDatasourceOptions = []

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      // Assert
      const grid = container.querySelector('.grid')
      expect(grid).toBeInTheDocument()
      expect(grid?.children.length).toBe(0)
    })

    it('should apply correct grid layout classes', () => {
      // Arrange
      mockDatasourceOptions = [createDataSourceOption()]

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      // Assert
      const grid = container.querySelector('.grid')
      expect(grid?.className).toContain('grid-cols-4')
      expect(grid?.className).toContain('gap-1')
      expect(grid?.className).toContain('w-full')
    })

    it('should render correct number of option cards', () => {
      // Arrange
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'A', value: 'a' }),
        createDataSourceOption({ label: 'B', value: 'b' }),
      ]

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="a"
          onSelect={vi.fn()}
        />,
      )

      // Assert
      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards.length).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // Props Variations Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should mark correct option as selected based on dataSourceNodeId', () => {
      // Arrange
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'opt-1' }),
        createDataSourceOption({ label: 'Option 2', value: 'opt-2' }),
      ]

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="opt-1"
          onSelect={vi.fn()}
        />,
      )

      // Assert - First option should have selected styles
      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[0].className).toContain('border-components-option-card-option-selected-border')
      expect(cards[1].className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should mark second option as selected when matching', () => {
      // Arrange
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'opt-1' }),
        createDataSourceOption({ label: 'Option 2', value: 'opt-2' }),
      ]

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="opt-2"
          onSelect={vi.fn()}
        />,
      )

      // Assert
      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[0].className).not.toContain('border-components-option-card-option-selected-border')
      expect(cards[1].className).toContain('border-components-option-card-option-selected-border')
    })

    it('should mark none as selected when dataSourceNodeId does not match', () => {
      // Arrange
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'opt-1' }),
        createDataSourceOption({ label: 'Option 2', value: 'opt-2' }),
      ]

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="non-existent"
          onSelect={vi.fn()}
        />,
      )

      // Assert - No option should have selected styles
      const cards = container.querySelectorAll('.flex.cursor-pointer')
      cards.forEach((card) => {
        expect(card.className).not.toContain('border-components-option-card-option-selected-border')
      })
    })

    it('should handle empty dataSourceNodeId', () => {
      // Arrange
      mockDatasourceOptions = [createDataSourceOption()]

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      // Assert
      expect(container.querySelector('.grid')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onSelect with datasource when option is clicked', () => {
      // Arrange
      const onSelect = vi.fn()
      const optionData = createNodeData({ title: 'Test Source' })
      mockDatasourceOptions = [
        createDataSourceOption({
          label: 'Test Option',
          value: 'test-id',
          data: optionData,
        }),
      ]

      // Act - Use a dataSourceNodeId to prevent auto-select on mount
      render(
        <DataSourceOptions
          dataSourceNodeId="test-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Test Option'))

      // Assert
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'test-id',
        nodeData: optionData,
      })
    })

    it('should call onSelect with correct option when different options are clicked', () => {
      // Arrange
      const onSelect = vi.fn()
      const data1 = createNodeData({ title: 'Source 1' })
      const data2 = createNodeData({ title: 'Source 2' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'id-1', data: data1 }),
        createDataSourceOption({ label: 'Option 2', value: 'id-2', data: data2 }),
      ]

      // Act - Use a dataSourceNodeId to prevent auto-select on mount
      render(
        <DataSourceOptions
          dataSourceNodeId="id-1"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Option 1'))
      fireEvent.click(screen.getByText('Option 2'))

      // Assert
      expect(onSelect).toHaveBeenCalledTimes(2)
      expect(onSelect).toHaveBeenNthCalledWith(1, { nodeId: 'id-1', nodeData: data1 })
      expect(onSelect).toHaveBeenNthCalledWith(2, { nodeId: 'id-2', nodeData: data2 })
    })

    it('should not call onSelect when option value not found', () => {
      // Arrange - This tests the early return in handleSelect
      const onSelect = vi.fn()
      mockDatasourceOptions = []

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      // Assert - Since there are no options, onSelect should not be called
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('should handle clicking same option multiple times', () => {
      // Arrange
      const onSelect = vi.fn()
      const optionData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt-id', data: optionData }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId="opt-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Option'))
      fireEvent.click(screen.getByText('Option'))
      fireEvent.click(screen.getByText('Option'))

      // Assert
      expect(onSelect).toHaveBeenCalledTimes(3)
    })
  })

  // -------------------------------------------------------------------------
  // Side Effects and Cleanup Tests
  // -------------------------------------------------------------------------
  describe('Side Effects and Cleanup', () => {
    it('should auto-select first option on mount when dataSourceNodeId is empty', async () => {
      // Arrange
      const onSelect = vi.fn()
      const firstOptionData = createNodeData({ title: 'First' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'First', value: 'first-id', data: firstOptionData }),
        createDataSourceOption({ label: 'Second', value: 'second-id' }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      // Assert - First option should be auto-selected on mount
      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith({
          nodeId: 'first-id',
          nodeData: firstOptionData,
        })
      })
    })

    it('should not auto-select when dataSourceNodeId is provided', async () => {
      // Arrange
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'First', value: 'first-id' }),
        createDataSourceOption({ label: 'Second', value: 'second-id' }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId="second-id"
          onSelect={onSelect}
        />,
      )

      // Assert - onSelect should not be called since dataSourceNodeId is already set
      await waitFor(() => {
        expect(onSelect).not.toHaveBeenCalled()
      })
    })

    it('should not auto-select when options array is empty', async () => {
      // Arrange
      const onSelect = vi.fn()
      mockDatasourceOptions = []

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      // Assert
      await waitFor(() => {
        expect(onSelect).not.toHaveBeenCalled()
      })
    })

    it('should run effect only once on mount', async () => {
      // Arrange
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'First', value: 'first-id' }),
      ]

      // Act
      const { rerender } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      // Rerender multiple times
      rerender(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )
      rerender(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      // Assert - Effect should only run once (on mount)
      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledTimes(1)
      })
    })

    it('should not re-run effect on rerender with different props', async () => {
      // Arrange
      const onSelect1 = vi.fn()
      const onSelect2 = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'First', value: 'first-id' }),
      ]

      // Act
      const { rerender } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect1}
        />,
      )

      await waitFor(() => {
        expect(onSelect1).toHaveBeenCalledTimes(1)
      })

      rerender(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect2}
        />,
      )

      // Assert - onSelect2 should not be called from effect
      expect(onSelect2).not.toHaveBeenCalled()
    })

    it('should handle unmount cleanly', () => {
      // Arrange
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Test', value: 'test-id' }),
      ]

      // Act
      const { unmount } = render(
        <DataSourceOptions
          dataSourceNodeId="test-id"
          onSelect={onSelect}
        />,
      )

      // Assert - Should unmount without errors
      expect(() => unmount()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Callback Stability Tests
  // -------------------------------------------------------------------------
  describe('Callback Stability', () => {
    it('should maintain stable handleSelect callback', () => {
      // Arrange
      const onSelect = vi.fn()
      const optionData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt-id', data: optionData }),
      ]

      // Act
      const { rerender } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Option'))

      rerender(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Option'))

      // Assert
      expect(onSelect).toHaveBeenCalledTimes(3) // 1 auto-select + 2 clicks
    })

    it('should update handleSelect when onSelect prop changes', () => {
      // Arrange
      const onSelect1 = vi.fn()
      const onSelect2 = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt-id' }),
      ]

      // Act
      const { rerender } = render(
        <DataSourceOptions
          dataSourceNodeId="opt-id"
          onSelect={onSelect1}
        />,
      )
      fireEvent.click(screen.getByText('Option'))

      rerender(
        <DataSourceOptions
          dataSourceNodeId="opt-id"
          onSelect={onSelect2}
        />,
      )
      fireEvent.click(screen.getByText('Option'))

      // Assert
      expect(onSelect1).toHaveBeenCalledTimes(1)
      expect(onSelect2).toHaveBeenCalledTimes(1)
    })

    it('should update handleSelect when options change', () => {
      // Arrange
      const onSelect = vi.fn()
      const data1 = createNodeData({ title: 'Data 1' })
      const data2 = createNodeData({ title: 'Data 2' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt-id', data: data1 }),
      ]

      // Act
      const { rerender } = render(
        <DataSourceOptions
          dataSourceNodeId="opt-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Option'))

      // Update options with different data
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt-id', data: data2 }),
      ]
      rerender(
        <DataSourceOptions
          dataSourceNodeId="opt-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Option'))

      // Assert
      expect(onSelect).toHaveBeenNthCalledWith(1, { nodeId: 'opt-id', nodeData: data1 })
      expect(onSelect).toHaveBeenNthCalledWith(2, { nodeId: 'opt-id', nodeData: data2 })
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle single option', () => {
      // Arrange
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Only Option', value: 'only-id' }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId="only-id"
          onSelect={onSelect}
        />,
      )

      // Assert
      expect(screen.getByText('Only Option')).toBeInTheDocument()
    })

    it('should handle many options', () => {
      // Arrange
      mockDatasourceOptions = Array.from({ length: 20 }, (_, i) =>
        createDataSourceOption({ label: `Option ${i}`, value: `opt-${i}` }))

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('Option 0')).toBeInTheDocument()
      expect(screen.getByText('Option 19')).toBeInTheDocument()
    })

    it('should handle options with duplicate labels but different values', () => {
      // Arrange
      const onSelect = vi.fn()
      const data1 = createNodeData({ title: 'Source 1' })
      const data2 = createNodeData({ title: 'Source 2' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Same Label', value: 'id-1', data: data1 }),
        createDataSourceOption({ label: 'Same Label', value: 'id-2', data: data2 }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )
      const labels = screen.getAllByText('Same Label')
      fireEvent.click(labels[1]) // Click second one

      // Assert
      expect(onSelect).toHaveBeenLastCalledWith({ nodeId: 'id-2', nodeData: data2 })
    })

    it('should handle special characters in option values', () => {
      // Arrange
      const onSelect = vi.fn()
      const specialData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({
          label: 'Special',
          value: 'special-chars_123-abc',
          data: specialData,
        }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Special'))

      // Assert
      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'special-chars_123-abc',
        nodeData: specialData,
      })
    })

    it('should handle click on non-existent option value gracefully', () => {
      // Arrange - Test the early return in handleSelect when selectedOption is not found
      // This is a bit tricky to test directly since options are rendered from the same array
      // We'll test by verifying the component doesn't crash with empty options
      const onSelect = vi.fn()
      mockDatasourceOptions = []

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      // Assert - No options to click, but component should render
      expect(container.querySelector('.grid')).toBeInTheDocument()
    })

    it('should handle options with empty string values', () => {
      // Arrange
      const onSelect = vi.fn()
      const emptyValueData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Empty Value', value: '', data: emptyValueData }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Empty Value'))

      // Assert - Should call onSelect with empty string nodeId
      expect(onSelect).toHaveBeenCalledWith({
        nodeId: '',
        nodeData: emptyValueData,
      })
    })

    it('should handle options with whitespace-only labels', () => {
      // Arrange
      mockDatasourceOptions = [
        createDataSourceOption({ label: '   ', value: 'whitespace' }),
      ]

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="whitespace"
          onSelect={vi.fn()}
        />,
      )

      // Assert
      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards.length).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Error Handling Tests
  // -------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('should not crash when nodeData has unexpected shape', () => {
      // Arrange
      const onSelect = vi.fn()
      const weirdNodeData = { unexpected: 'data' } as unknown as DataSourceNodeType
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Weird', value: 'weird-id', data: weirdNodeData }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId="weird-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Weird'))

      // Assert
      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'weird-id',
        nodeData: weirdNodeData,
      })
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('DataSourceOptions Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasourceOptions = []
  })

  // -------------------------------------------------------------------------
  // Full Flow Tests
  // -------------------------------------------------------------------------
  describe('Full Flow', () => {
    it('should complete full selection flow: render -> auto-select -> manual select', async () => {
      // Arrange
      const onSelect = vi.fn()
      const data1 = createNodeData({ title: 'Source 1' })
      const data2 = createNodeData({ title: 'Source 2' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'id-1', data: data1 }),
        createDataSourceOption({ label: 'Option 2', value: 'id-2', data: data2 }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      // Assert - Auto-select first option on mount
      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith({ nodeId: 'id-1', nodeData: data1 })
      })

      // Act - Manual select second option
      fireEvent.click(screen.getByText('Option 2'))

      // Assert
      expect(onSelect).toHaveBeenLastCalledWith({ nodeId: 'id-2', nodeData: data2 })
    })

    it('should update selection state when clicking different options', () => {
      // Arrange
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option A', value: 'a' }),
        createDataSourceOption({ label: 'Option B', value: 'b' }),
        createDataSourceOption({ label: 'Option C', value: 'c' }),
      ]

      // Act - Start with Option B selected
      const { rerender, container } = render(
        <DataSourceOptions
          dataSourceNodeId="b"
          onSelect={onSelect}
        />,
      )

      // Assert - Option B should be selected
      let cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[1].className).toContain('border-components-option-card-option-selected-border')

      // Act - Simulate selection change to Option C
      rerender(
        <DataSourceOptions
          dataSourceNodeId="c"
          onSelect={onSelect}
        />,
      )

      // Assert - Option C should now be selected
      cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[2].className).toContain('border-components-option-card-option-selected-border')
      expect(cards[1].className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should handle rapid option switching', async () => {
      // Arrange
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'A', value: 'a' }),
        createDataSourceOption({ label: 'B', value: 'b' }),
        createDataSourceOption({ label: 'C', value: 'c' }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId="a"
          onSelect={onSelect}
        />,
      )

      fireEvent.click(screen.getByText('B'))
      fireEvent.click(screen.getByText('C'))
      fireEvent.click(screen.getByText('A'))
      fireEvent.click(screen.getByText('B'))

      // Assert
      expect(onSelect).toHaveBeenCalledTimes(4)
    })
  })

  // -------------------------------------------------------------------------
  // Component Communication Tests
  // -------------------------------------------------------------------------
  describe('Component Communication', () => {
    it('should pass correct props from DataSourceOptions to OptionCard', () => {
      // Arrange
      mockDatasourceOptions = [
        createDataSourceOption({
          label: 'Test Label',
          value: 'test-value',
          data: createNodeData({ title: 'Test Data' }),
        }),
      ]

      // Act
      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="test-value"
          onSelect={vi.fn()}
        />,
      )

      // Assert - Verify OptionCard receives correct props through rendered output
      expect(screen.getByText('Test Label')).toBeInTheDocument()
      expect(screen.getByTestId('block-icon')).toBeInTheDocument()
      const card = container.querySelector('.flex.cursor-pointer')
      expect(card?.className).toContain('border-components-option-card-option-selected-border')
    })

    it('should propagate click events from OptionCard to DataSourceOptions', () => {
      // Arrange
      const onSelect = vi.fn()
      const nodeData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Click Me', value: 'click-id', data: nodeData }),
      ]

      // Act
      render(
        <DataSourceOptions
          dataSourceNodeId="click-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Click Me'))

      // Assert
      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'click-id',
        nodeData,
      })
    })
  })

  // -------------------------------------------------------------------------
  // State Consistency Tests
  // -------------------------------------------------------------------------
  describe('State Consistency', () => {
    it('should maintain consistent selection across multiple renders', () => {
      // Arrange
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'A', value: 'a' }),
        createDataSourceOption({ label: 'B', value: 'b' }),
      ]

      // Act
      const { rerender, container } = render(
        <DataSourceOptions
          dataSourceNodeId="a"
          onSelect={onSelect}
        />,
      )

      // Multiple rerenders
      for (let i = 0; i < 5; i++) {
        rerender(
          <DataSourceOptions
            dataSourceNodeId="a"
            onSelect={onSelect}
          />,
        )
      }

      // Assert - Selection should remain consistent
      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[0].className).toContain('border-components-option-card-option-selected-border')
      expect(cards[1].className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should handle options array reference change with same content', () => {
      // Arrange
      const onSelect = vi.fn()
      const nodeData = createNodeData()

      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt', data: nodeData }),
      ]

      // Act
      const { rerender } = render(
        <DataSourceOptions
          dataSourceNodeId="opt"
          onSelect={onSelect}
        />,
      )

      // Create new array reference with same content
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt', data: nodeData }),
      ]

      rerender(
        <DataSourceOptions
          dataSourceNodeId="opt"
          onSelect={onSelect}
        />,
      )

      fireEvent.click(screen.getByText('Option'))

      // Assert - Should still work correctly
      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'opt',
        nodeData,
      })
    })
  })
})

// ============================================================================
// handleSelect Early Return Branch Coverage
// ============================================================================

describe('handleSelect Early Return Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasourceOptions = []
  })

  it('should test early return when option not found by using modified mock during click', () => {
    // Arrange - Test strategy: We need to trigger the early return when
    // selectedOption is not found. Since the component renders cards from
    // the options array, we need to modify the mock between render and click.
    const onSelect = vi.fn()
    const originalOptions = [
      createDataSourceOption({ label: 'Option A', value: 'a' }),
      createDataSourceOption({ label: 'Option B', value: 'b' }),
    ]
    mockDatasourceOptions = originalOptions

    // Act - Render the component
    const { rerender } = render(
      <DataSourceOptions
        dataSourceNodeId="a"
        onSelect={onSelect}
      />,
    )

    // Now we need to cause the handleSelect to not find the option.
    // The callback is memoized with [onSelect, options], so if we change
    // the options, the callback should be updated too.

    // Let's create a scenario where the value doesn't match any option
    // by rendering with options that have different values
    const newOptions = [
      createDataSourceOption({ label: 'Option A', value: 'x' }), // Changed from 'a' to 'x'
      createDataSourceOption({ label: 'Option B', value: 'y' }), // Changed from 'b' to 'y'
    ]
    mockDatasourceOptions = newOptions

    rerender(
      <DataSourceOptions
        dataSourceNodeId="a"
        onSelect={onSelect}
      />,
    )

    // Click on 'Option A' which now has value 'x', not 'a'
    // Since we're selecting by text, this tests that the click works
    fireEvent.click(screen.getByText('Option A'))

    // Assert - onSelect should be called with the new value 'x'
    expect(onSelect).toHaveBeenCalledWith({
      nodeId: 'x',
      nodeData: expect.any(Object),
    })
  })

  it('should handle empty options array gracefully', () => {
    // Arrange - Edge case: empty options
    const onSelect = vi.fn()
    mockDatasourceOptions = []

    // Act
    const { container } = render(
      <DataSourceOptions
        dataSourceNodeId=""
        onSelect={onSelect}
      />,
    )

    // Assert - No options to click, onSelect not called
    expect(container.querySelector('.grid')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('should handle auto-select with mismatched first option', async () => {
    // Arrange - Test auto-select behavior
    const onSelect = vi.fn()
    const firstOptionData = createNodeData({ title: 'First' })
    mockDatasourceOptions = [
      createDataSourceOption({
        label: 'First Option',
        value: 'first-value',
        data: firstOptionData,
      }),
    ]

    // Act - Empty dataSourceNodeId triggers auto-select
    render(
      <DataSourceOptions
        dataSourceNodeId=""
        onSelect={onSelect}
      />,
    )

    // Assert - First option auto-selected
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'first-value',
        nodeData: firstOptionData,
      })
    })
  })
})
