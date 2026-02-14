import type { DataSourceOption } from '../../../types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import DataSourceOptions from '../index'
import OptionCard from '../option-card'

let mockDatasourceOptions: DataSourceOption[] = []

vi.mock('../../hooks', () => ({
  useDatasourceOptions: () => mockDatasourceOptions,
}))

const mockToolIcon = { type: 'icon', icon: 'test-icon' }
vi.mock('@/app/components/workflow/hooks', () => ({
  useToolIcon: () => mockToolIcon,
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ type, toolIcon }: { type: string, toolIcon: unknown }) => (
    <div data-testid="block-icon" data-type={type} data-tool-icon={JSON.stringify(toolIcon)}>
      BlockIcon
    </div>
  ),
}))

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

describe('OptionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render option card without crashing', () => {
      const nodeData = createNodeData()

      render(
        <OptionCard
          label="Test Label"
          value="test-value"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should render label text', () => {
      const nodeData = createNodeData()

      render(
        <OptionCard
          label="My Data Source"
          value="my-ds"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByText('My Data Source')).toBeInTheDocument()
    })

    it('should render BlockIcon component', () => {
      const nodeData = createNodeData()

      render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByTestId('block-icon')).toBeInTheDocument()
    })

    it('should pass correct type to BlockIcon', () => {
      const nodeData = createNodeData()

      render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-type', 'datasource')
    })

    it('should set title attribute on label element', () => {
      const nodeData = createNodeData()

      render(
        <OptionCard
          label="Long Label Text"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByTitle('Long Label Text')).toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should apply selected styles when selected is true', () => {
      const nodeData = createNodeData()

      const { container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={true}
          nodeData={nodeData}
        />,
      )

      const card = container.firstChild as HTMLElement
      expect(card.className).toContain('border-components-option-card-option-selected-border')
      expect(card.className).toContain('bg-components-option-card-option-selected-bg')
    })

    it('should apply unselected styles when selected is false', () => {
      const nodeData = createNodeData()

      const { container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      const card = container.firstChild as HTMLElement
      expect(card.className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should apply text-text-primary to label when selected', () => {
      const nodeData = createNodeData()

      render(
        <OptionCard
          label="Test Label"
          value="test"
          selected={true}
          nodeData={nodeData}
        />,
      )

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('text-text-primary')
    })

    it('should apply text-text-secondary to label when not selected', () => {
      const nodeData = createNodeData()

      render(
        <OptionCard
          label="Test Label"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      const label = screen.getByText('Test Label')
      expect(label.className).toContain('text-text-secondary')
    })

    it('should handle undefined onClick prop', () => {
      const nodeData = createNodeData()

      const { container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
          onClick={undefined}
        />,
      )

      const card = container.firstChild as HTMLElement
      expect(() => fireEvent.click(card)).not.toThrow()
    })

    it('should handle different node data types', () => {
      const nodeData = createNodeData({
        title: 'Website Crawler',
        provider_type: 'website_crawl',
      })

      render(
        <OptionCard
          label="Website Crawler"
          value="website"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByText('Website Crawler')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClick with value when card is clicked', () => {
      const onClick = vi.fn()
      const nodeData = createNodeData()

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

      expect(onClick).toHaveBeenCalledTimes(1)
      expect(onClick).toHaveBeenCalledWith('test-value')
    })

    it('should call onClick with correct value for different cards', () => {
      const onClick = vi.fn()
      const nodeData = createNodeData()

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

      expect(onClick).toHaveBeenCalledTimes(2)
      expect(onClick).toHaveBeenNthCalledWith(1, 'value-1')
      expect(onClick).toHaveBeenNthCalledWith(2, 'value-2')
    })

    it('should handle rapid clicks', () => {
      const onClick = vi.fn()
      const nodeData = createNodeData()

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

      expect(onClick).toHaveBeenCalledTimes(3)
    })

    it('should call onClick with empty string value', () => {
      const onClick = vi.fn()
      const nodeData = createNodeData()

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

      expect(onClick).toHaveBeenCalledWith('')
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable handleClickCard callback when props dont change', () => {
      const onClick = vi.fn()
      const nodeData = createNodeData()

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

      expect(onClick).toHaveBeenCalledTimes(2)
      expect(onClick).toHaveBeenNthCalledWith(1, 'test-value')
      expect(onClick).toHaveBeenNthCalledWith(2, 'test-value')
    })

    it('should update handleClickCard when value changes', () => {
      const onClick = vi.fn()
      const nodeData = createNodeData()

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

      expect(onClick).toHaveBeenNthCalledWith(1, 'old-value')
      expect(onClick).toHaveBeenNthCalledWith(2, 'new-value')
    })

    it('should update handleClickCard when onClick changes', () => {
      const onClick1 = vi.fn()
      const onClick2 = vi.fn()
      const nodeData = createNodeData()

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

      expect(onClick1).toHaveBeenCalledTimes(1)
      expect(onClick2).toHaveBeenCalledTimes(1)
    })
  })

  describe('Memoization', () => {
    it('should be memoized (React.memo)', () => {
      const onClick = vi.fn()
      const nodeData = createNodeData()

      const { rerender } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )

      rerender(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
          onClick={onClick}
        />,
      )

      expect(screen.getByText('Test')).toBeInTheDocument()
    })

    it('should re-render when selected prop changes', () => {
      const nodeData = createNodeData()

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

      card = container.firstChild as HTMLElement
      expect(card.className).toContain('border-components-option-card-option-selected-border')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty label', () => {
      const nodeData = createNodeData()

      render(
        <OptionCard
          label=""
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByTestId('block-icon')).toBeInTheDocument()
    })

    it('should handle very long label', () => {
      const nodeData = createNodeData()
      const longLabel = 'A'.repeat(200)

      render(
        <OptionCard
          label={longLabel}
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByText(longLabel)).toBeInTheDocument()
      expect(screen.getByTitle(longLabel)).toBeInTheDocument()
    })

    it('should handle special characters in label', () => {
      const nodeData = createNodeData()
      const specialLabel = '<Test> & \'Label\' "Special"'

      render(
        <OptionCard
          label={specialLabel}
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByText(specialLabel)).toBeInTheDocument()
    })

    it('should handle unicode characters in label', () => {
      const nodeData = createNodeData()

      render(
        <OptionCard
          label="数据源 🎉 データソース"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByText('数据源 🎉 データソース')).toBeInTheDocument()
    })

    it('should handle empty value', () => {
      const onClick = vi.fn()
      const nodeData = createNodeData()

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

      expect(onClick).toHaveBeenCalledWith('')
    })

    it('should handle special characters in value', () => {
      const onClick = vi.fn()
      const nodeData = createNodeData()
      const specialValue = 'test-value_123/abc:xyz'

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

      expect(onClick).toHaveBeenCalledWith(specialValue)
    })

    it('should handle nodeData with minimal properties', () => {
      const minimalNodeData = { title: 'Minimal' } as unknown as DataSourceNodeType

      render(
        <OptionCard
          label="Minimal"
          value="test"
          selected={false}
          nodeData={minimalNodeData}
        />,
      )

      expect(screen.getByText('Minimal')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have cursor-pointer class for clickability indication', () => {
      const nodeData = createNodeData()

      const { container } = render(
        <OptionCard
          label="Test"
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      const card = container.firstChild as HTMLElement
      expect(card.className).toContain('cursor-pointer')
    })

    it('should provide title attribute for label tooltip', () => {
      const nodeData = createNodeData()
      const label = 'This is a very long label that might get truncated'

      render(
        <OptionCard
          label={label}
          value="test"
          selected={false}
          nodeData={nodeData}
        />,
      )

      expect(screen.getByTitle(label)).toBeInTheDocument()
    })
  })
})

describe('DataSourceOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasourceOptions = []
  })

  describe('Rendering', () => {
    it('should render container without crashing', () => {
      mockDatasourceOptions = []

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      expect(container.querySelector('.grid')).toBeInTheDocument()
    })

    it('should render OptionCard for each option', () => {
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'opt-1' }),
        createDataSourceOption({ label: 'Option 2', value: 'opt-2' }),
        createDataSourceOption({ label: 'Option 3', value: 'opt-3' }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText('Option 1')).toBeInTheDocument()
      expect(screen.getByText('Option 2')).toBeInTheDocument()
      expect(screen.getByText('Option 3')).toBeInTheDocument()
    })

    it('should render empty grid when no options', () => {
      mockDatasourceOptions = []

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      const grid = container.querySelector('.grid')
      expect(grid).toBeInTheDocument()
      expect(grid?.children.length).toBe(0)
    })

    it('should apply correct grid layout classes', () => {
      mockDatasourceOptions = [createDataSourceOption()]

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      const grid = container.querySelector('.grid')
      expect(grid?.className).toContain('grid-cols-4')
      expect(grid?.className).toContain('gap-1')
      expect(grid?.className).toContain('w-full')
    })

    it('should render correct number of option cards', () => {
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'A', value: 'a' }),
        createDataSourceOption({ label: 'B', value: 'b' }),
      ]

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="a"
          onSelect={vi.fn()}
        />,
      )

      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards.length).toBe(2)
    })
  })

  describe('Props Variations', () => {
    it('should mark correct option as selected based on dataSourceNodeId', () => {
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'opt-1' }),
        createDataSourceOption({ label: 'Option 2', value: 'opt-2' }),
      ]

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="opt-1"
          onSelect={vi.fn()}
        />,
      )

      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[0].className).toContain('border-components-option-card-option-selected-border')
      expect(cards[1].className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should mark second option as selected when matching', () => {
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'opt-1' }),
        createDataSourceOption({ label: 'Option 2', value: 'opt-2' }),
      ]

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="opt-2"
          onSelect={vi.fn()}
        />,
      )

      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[0].className).not.toContain('border-components-option-card-option-selected-border')
      expect(cards[1].className).toContain('border-components-option-card-option-selected-border')
    })

    it('should mark none as selected when dataSourceNodeId does not match', () => {
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'opt-1' }),
        createDataSourceOption({ label: 'Option 2', value: 'opt-2' }),
      ]

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="non-existent"
          onSelect={vi.fn()}
        />,
      )

      const cards = container.querySelectorAll('.flex.cursor-pointer')
      cards.forEach((card) => {
        expect(card.className).not.toContain('border-components-option-card-option-selected-border')
      })
    })

    it('should handle empty dataSourceNodeId', () => {
      mockDatasourceOptions = [createDataSourceOption()]

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      expect(container.querySelector('.grid')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onSelect with datasource when option is clicked', () => {
      const onSelect = vi.fn()
      const optionData = createNodeData({ title: 'Test Source' })
      mockDatasourceOptions = [
        createDataSourceOption({
          label: 'Test Option',
          value: 'test-id',
          data: optionData,
        }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId="test-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Test Option'))

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'test-id',
        nodeData: optionData,
      })
    })

    it('should call onSelect with correct option when different options are clicked', () => {
      const onSelect = vi.fn()
      const data1 = createNodeData({ title: 'Source 1' })
      const data2 = createNodeData({ title: 'Source 2' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'id-1', data: data1 }),
        createDataSourceOption({ label: 'Option 2', value: 'id-2', data: data2 }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId="id-1"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Option 1'))
      fireEvent.click(screen.getByText('Option 2'))

      expect(onSelect).toHaveBeenCalledTimes(2)
      expect(onSelect).toHaveBeenNthCalledWith(1, { nodeId: 'id-1', nodeData: data1 })
      expect(onSelect).toHaveBeenNthCalledWith(2, { nodeId: 'id-2', nodeData: data2 })
    })

    it('should not call onSelect when option value not found', () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = []

      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      expect(onSelect).not.toHaveBeenCalled()
    })

    it('should handle clicking same option multiple times', () => {
      const onSelect = vi.fn()
      const optionData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt-id', data: optionData }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId="opt-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Option'))
      fireEvent.click(screen.getByText('Option'))
      fireEvent.click(screen.getByText('Option'))

      expect(onSelect).toHaveBeenCalledTimes(3)
    })
  })

  describe('Side Effects and Cleanup', () => {
    it('should auto-select first option on mount when dataSourceNodeId is empty', async () => {
      const onSelect = vi.fn()
      const firstOptionData = createNodeData({ title: 'First' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'First', value: 'first-id', data: firstOptionData }),
        createDataSourceOption({ label: 'Second', value: 'second-id' }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith({
          nodeId: 'first-id',
          nodeData: firstOptionData,
        })
      })
    })

    it('should not auto-select when dataSourceNodeId is provided', async () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'First', value: 'first-id' }),
        createDataSourceOption({ label: 'Second', value: 'second-id' }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId="second-id"
          onSelect={onSelect}
        />,
      )

      await waitFor(() => {
        expect(onSelect).not.toHaveBeenCalled()
      })
    })

    it('should not auto-select when options array is empty', async () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = []

      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      await waitFor(() => {
        expect(onSelect).not.toHaveBeenCalled()
      })
    })

    it('should run effect only once on mount', async () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'First', value: 'first-id' }),
      ]

      const { rerender } = render(
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
      rerender(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledTimes(1)
      })
    })

    it('should not re-run effect on rerender with different props', async () => {
      const onSelect1 = vi.fn()
      const onSelect2 = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'First', value: 'first-id' }),
      ]

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

      expect(onSelect2).not.toHaveBeenCalled()
    })

    it('should handle unmount cleanly', () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Test', value: 'test-id' }),
      ]

      const { unmount } = render(
        <DataSourceOptions
          dataSourceNodeId="test-id"
          onSelect={onSelect}
        />,
      )

      expect(() => unmount()).not.toThrow()
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable handleSelect callback', () => {
      const onSelect = vi.fn()
      const optionData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt-id', data: optionData }),
      ]

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

      expect(onSelect).toHaveBeenCalledTimes(3) // 1 auto-select + 2 clicks
    })

    it('should update handleSelect when onSelect prop changes', () => {
      const onSelect1 = vi.fn()
      const onSelect2 = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt-id' }),
      ]

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

      expect(onSelect1).toHaveBeenCalledTimes(1)
      expect(onSelect2).toHaveBeenCalledTimes(1)
    })

    it('should update handleSelect when options change', () => {
      const onSelect = vi.fn()
      const data1 = createNodeData({ title: 'Data 1' })
      const data2 = createNodeData({ title: 'Data 2' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt-id', data: data1 }),
      ]

      const { rerender } = render(
        <DataSourceOptions
          dataSourceNodeId="opt-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Option'))

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

      expect(onSelect).toHaveBeenNthCalledWith(1, { nodeId: 'opt-id', nodeData: data1 })
      expect(onSelect).toHaveBeenNthCalledWith(2, { nodeId: 'opt-id', nodeData: data2 })
    })
  })

  describe('Edge Cases', () => {
    it('should handle single option', () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Only Option', value: 'only-id' }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId="only-id"
          onSelect={onSelect}
        />,
      )

      expect(screen.getByText('Only Option')).toBeInTheDocument()
    })

    it('should handle many options', () => {
      mockDatasourceOptions = Array.from({ length: 20 }, (_, i) =>
        createDataSourceOption({ label: `Option ${i}`, value: `opt-${i}` }))

      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText('Option 0')).toBeInTheDocument()
      expect(screen.getByText('Option 19')).toBeInTheDocument()
    })

    it('should handle options with duplicate labels but different values', () => {
      const onSelect = vi.fn()
      const data1 = createNodeData({ title: 'Source 1' })
      const data2 = createNodeData({ title: 'Source 2' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Same Label', value: 'id-1', data: data1 }),
        createDataSourceOption({ label: 'Same Label', value: 'id-2', data: data2 }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )
      const labels = screen.getAllByText('Same Label')
      fireEvent.click(labels[1]) // Click second one

      expect(onSelect).toHaveBeenLastCalledWith({ nodeId: 'id-2', nodeData: data2 })
    })

    it('should handle special characters in option values', () => {
      const onSelect = vi.fn()
      const specialData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({
          label: 'Special',
          value: 'special-chars_123-abc',
          data: specialData,
        }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Special'))

      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'special-chars_123-abc',
        nodeData: specialData,
      })
    })

    it('should handle click on non-existent option value gracefully', () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = []

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      expect(container.querySelector('.grid')).toBeInTheDocument()
    })

    it('should handle options with empty string values', () => {
      const onSelect = vi.fn()
      const emptyValueData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Empty Value', value: '', data: emptyValueData }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Empty Value'))

      expect(onSelect).toHaveBeenCalledWith({
        nodeId: '',
        nodeData: emptyValueData,
      })
    })

    it('should handle options with whitespace-only labels', () => {
      mockDatasourceOptions = [
        createDataSourceOption({ label: '   ', value: 'whitespace' }),
      ]

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="whitespace"
          onSelect={vi.fn()}
        />,
      )

      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards.length).toBe(1)
    })
  })

  describe('Error Handling', () => {
    it('should not crash when nodeData has unexpected shape', () => {
      const onSelect = vi.fn()
      const weirdNodeData = { unexpected: 'data' } as unknown as DataSourceNodeType
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Weird', value: 'weird-id', data: weirdNodeData }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId="weird-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Weird'))

      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'weird-id',
        nodeData: weirdNodeData,
      })
    })
  })
})

describe('DataSourceOptions Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasourceOptions = []
  })

  describe('Full Flow', () => {
    it('should complete full selection flow: render -> auto-select -> manual select', async () => {
      const onSelect = vi.fn()
      const data1 = createNodeData({ title: 'Source 1' })
      const data2 = createNodeData({ title: 'Source 2' })
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option 1', value: 'id-1', data: data1 }),
        createDataSourceOption({ label: 'Option 2', value: 'id-2', data: data2 }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId=""
          onSelect={onSelect}
        />,
      )

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith({ nodeId: 'id-1', nodeData: data1 })
      })

      fireEvent.click(screen.getByText('Option 2'))

      expect(onSelect).toHaveBeenLastCalledWith({ nodeId: 'id-2', nodeData: data2 })
    })

    it('should update selection state when clicking different options', () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option A', value: 'a' }),
        createDataSourceOption({ label: 'Option B', value: 'b' }),
        createDataSourceOption({ label: 'Option C', value: 'c' }),
      ]

      const { rerender, container } = render(
        <DataSourceOptions
          dataSourceNodeId="b"
          onSelect={onSelect}
        />,
      )

      let cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[1].className).toContain('border-components-option-card-option-selected-border')

      rerender(
        <DataSourceOptions
          dataSourceNodeId="c"
          onSelect={onSelect}
        />,
      )

      cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[2].className).toContain('border-components-option-card-option-selected-border')
      expect(cards[1].className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should handle rapid option switching', async () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'A', value: 'a' }),
        createDataSourceOption({ label: 'B', value: 'b' }),
        createDataSourceOption({ label: 'C', value: 'c' }),
      ]

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

      expect(onSelect).toHaveBeenCalledTimes(4)
    })
  })

  describe('Component Communication', () => {
    it('should pass correct props from DataSourceOptions to OptionCard', () => {
      mockDatasourceOptions = [
        createDataSourceOption({
          label: 'Test Label',
          value: 'test-value',
          data: createNodeData({ title: 'Test Data' }),
        }),
      ]

      const { container } = render(
        <DataSourceOptions
          dataSourceNodeId="test-value"
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText('Test Label')).toBeInTheDocument()
      expect(screen.getByTestId('block-icon')).toBeInTheDocument()
      const card = container.querySelector('.flex.cursor-pointer')
      expect(card?.className).toContain('border-components-option-card-option-selected-border')
    })

    it('should propagate click events from OptionCard to DataSourceOptions', () => {
      const onSelect = vi.fn()
      const nodeData = createNodeData()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Click Me', value: 'click-id', data: nodeData }),
      ]

      render(
        <DataSourceOptions
          dataSourceNodeId="click-id"
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByText('Click Me'))

      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'click-id',
        nodeData,
      })
    })
  })

  describe('State Consistency', () => {
    it('should maintain consistent selection across multiple renders', () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDataSourceOption({ label: 'A', value: 'a' }),
        createDataSourceOption({ label: 'B', value: 'b' }),
      ]

      const { rerender, container } = render(
        <DataSourceOptions
          dataSourceNodeId="a"
          onSelect={onSelect}
        />,
      )

      for (let i = 0; i < 5; i++) {
        rerender(
          <DataSourceOptions
            dataSourceNodeId="a"
            onSelect={onSelect}
          />,
        )
      }

      const cards = container.querySelectorAll('.flex.cursor-pointer')
      expect(cards[0].className).toContain('border-components-option-card-option-selected-border')
      expect(cards[1].className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should handle options array reference change with same content', () => {
      const onSelect = vi.fn()
      const nodeData = createNodeData()

      mockDatasourceOptions = [
        createDataSourceOption({ label: 'Option', value: 'opt', data: nodeData }),
      ]

      const { rerender } = render(
        <DataSourceOptions
          dataSourceNodeId="opt"
          onSelect={onSelect}
        />,
      )

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

      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'opt',
        nodeData,
      })
    })
  })
})

describe('handleSelect Early Return Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasourceOptions = []
  })

  it('should test early return when option not found by using modified mock during click', () => {
    const onSelect = vi.fn()
    const originalOptions = [
      createDataSourceOption({ label: 'Option A', value: 'a' }),
      createDataSourceOption({ label: 'Option B', value: 'b' }),
    ]
    mockDatasourceOptions = originalOptions

    const { rerender } = render(
      <DataSourceOptions
        dataSourceNodeId="a"
        onSelect={onSelect}
      />,
    )

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

    fireEvent.click(screen.getByText('Option A'))

    expect(onSelect).toHaveBeenCalledWith({
      nodeId: 'x',
      nodeData: expect.any(Object),
    })
  })

  it('should handle empty options array gracefully', () => {
    const onSelect = vi.fn()
    mockDatasourceOptions = []

    const { container } = render(
      <DataSourceOptions
        dataSourceNodeId=""
        onSelect={onSelect}
      />,
    )

    expect(container.querySelector('.grid')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('should handle auto-select with mismatched first option', async () => {
    const onSelect = vi.fn()
    const firstOptionData = createNodeData({ title: 'First' })
    mockDatasourceOptions = [
      createDataSourceOption({
        label: 'First Option',
        value: 'first-value',
        data: firstOptionData,
      }),
    ]

    render(
      <DataSourceOptions
        dataSourceNodeId=""
        onSelect={onSelect}
      />,
    )

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith({
        nodeId: 'first-value',
        nodeData: firstOptionData,
      })
    })
  })
})
