import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import Datasource from '../datasource'
import GlobalInputs from '../global-inputs'

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ type, toolIcon, className }: { type: BlockEnum, toolIcon?: string, className?: string }) => (
    <div
      data-testid="block-icon"
      data-type={type}
      data-tool-icon={toolIcon || ''}
      className={className}
    />
  ),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useToolIcon: (nodeData: DataSourceNodeType) => nodeData.provider_name || 'default-icon',
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ popupContent, popupClassName }: { popupContent: string, popupClassName?: string }) => (
    <div data-testid="tooltip" data-content={popupContent} className={popupClassName} />
  ),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Datasource', () => {
  const createMockNodeData = (overrides?: Partial<DataSourceNodeType>): DataSourceNodeType => ({
    title: 'Test Data Source',
    desc: 'Test description',
    type: BlockEnum.DataSource,
    provider_name: 'test-provider',
    provider_type: 'api',
    datasource_name: 'test-datasource',
    datasource_label: 'Test Datasource',
    plugin_id: 'test-plugin',
    datasource_parameters: {},
    datasource_configurations: {},
    ...overrides,
  } as DataSourceNodeType)

  describe('rendering', () => {
    it('should render without crashing', () => {
      const nodeData = createMockNodeData()

      render(<Datasource nodeData={nodeData} />)

      expect(screen.getByTestId('block-icon')).toBeInTheDocument()
    })

    it('should render the node title', () => {
      const nodeData = createMockNodeData({ title: 'My Custom Data Source' })

      render(<Datasource nodeData={nodeData} />)

      expect(screen.getByText('My Custom Data Source')).toBeInTheDocument()
    })

    it('should render BlockIcon with correct type', () => {
      const nodeData = createMockNodeData()

      render(<Datasource nodeData={nodeData} />)

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-type', BlockEnum.DataSource)
    })

    it('should pass toolIcon from useToolIcon hook', () => {
      const nodeData = createMockNodeData({ provider_name: 'custom-provider' })

      render(<Datasource nodeData={nodeData} />)

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-tool-icon', 'custom-provider')
    })

    it('should have correct icon container styling', () => {
      const nodeData = createMockNodeData()

      const { container } = render(<Datasource nodeData={nodeData} />)

      const iconContainer = container.querySelector('.size-5')
      expect(iconContainer).toBeInTheDocument()
      expect(iconContainer).toHaveClass('flex', 'items-center', 'justify-center', 'rounded-md')
    })

    it('should have correct text styling', () => {
      const nodeData = createMockNodeData()

      render(<Datasource nodeData={nodeData} />)

      const titleElement = screen.getByText('Test Data Source')
      expect(titleElement).toHaveClass('system-sm-medium', 'text-text-secondary')
    })

    it('should have correct container layout', () => {
      const nodeData = createMockNodeData()

      const { container } = render(<Datasource nodeData={nodeData} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'items-center', 'gap-x-1.5')
    })
  })

  describe('memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((Datasource as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })

  describe('edge cases', () => {
    it('should handle empty title', () => {
      const nodeData = createMockNodeData({ title: '' })

      render(<Datasource nodeData={nodeData} />)

      expect(screen.getByTestId('block-icon')).toBeInTheDocument()
    })

    it('should handle long title', () => {
      const longTitle = 'A'.repeat(100)
      const nodeData = createMockNodeData({ title: longTitle })

      render(<Datasource nodeData={nodeData} />)

      expect(screen.getByText(longTitle)).toBeInTheDocument()
    })

    it('should handle special characters in title', () => {
      const nodeData = createMockNodeData({ title: 'Test <script>alert("xss")</script>' })

      render(<Datasource nodeData={nodeData} />)

      expect(screen.getByText('Test <script>alert("xss")</script>')).toBeInTheDocument()
    })
  })
})

describe('GlobalInputs', () => {
  describe('rendering', () => {
    it('should render without crashing', () => {
      render(<GlobalInputs />)

      expect(screen.getByText('datasetPipeline.inputFieldPanel.globalInputs.title')).toBeInTheDocument()
    })

    it('should render title with correct translation key', () => {
      render(<GlobalInputs />)

      expect(screen.getByText('datasetPipeline.inputFieldPanel.globalInputs.title')).toBeInTheDocument()
    })

    it('should render tooltip component', () => {
      render(<GlobalInputs />)

      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    })

    it('should pass correct tooltip content', () => {
      render(<GlobalInputs />)

      const tooltip = screen.getByTestId('tooltip')
      expect(tooltip).toHaveAttribute('data-content', 'datasetPipeline.inputFieldPanel.globalInputs.tooltip')
    })

    it('should have correct tooltip className', () => {
      render(<GlobalInputs />)

      const tooltip = screen.getByTestId('tooltip')
      expect(tooltip).toHaveClass('w-[240px]')
    })

    it('should have correct container layout', () => {
      const { container } = render(<GlobalInputs />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'items-center', 'gap-x-1')
    })

    it('should have correct title styling', () => {
      render(<GlobalInputs />)

      const titleElement = screen.getByText('datasetPipeline.inputFieldPanel.globalInputs.title')
      expect(titleElement).toHaveClass('system-sm-semibold-uppercase', 'text-text-secondary')
    })
  })

  describe('memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((GlobalInputs as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})
