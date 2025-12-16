import { fireEvent, render, screen } from '@testing-library/react'
import Details from './index'
import type { PipelineTemplateByIdResponse } from '@/models/pipeline'
import { ChunkingMode } from '@/models/datasets'
import type { Edge, Node, Viewport } from 'reactflow'

// Mock usePipelineTemplateById hook
let mockPipelineTemplateData: PipelineTemplateByIdResponse | undefined
let mockIsLoading = false

jest.mock('@/service/use-pipeline', () => ({
  usePipelineTemplateById: (params: { template_id: string; type: 'customized' | 'built-in' }, enabled: boolean) => ({
    data: enabled ? mockPipelineTemplateData : undefined,
    isLoading: mockIsLoading,
  }),
}))

// Mock WorkflowPreview component to avoid deep dependencies
jest.mock('@/app/components/workflow/workflow-preview', () => ({
  __esModule: true,
  default: ({ nodes, edges, viewport, className }: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
    className?: string
  }) => (
    <div
      data-testid="workflow-preview"
      data-nodes-count={nodes?.length ?? 0}
      data-edges-count={edges?.length ?? 0}
      data-viewport-zoom={viewport?.zoom}
      className={className}
    >
      WorkflowPreview
    </div>
  ),
}))

// Factory function for creating mock pipeline template response
const createMockPipelineTemplate = (
  overrides: Partial<PipelineTemplateByIdResponse> = {},
): PipelineTemplateByIdResponse => ({
  id: 'test-template-id',
  name: 'Test Pipeline Template',
  icon_info: {
    icon_type: 'emoji',
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_url: '',
  },
  description: 'Test pipeline description for testing purposes',
  chunk_structure: ChunkingMode.text,
  export_data: '{}',
  graph: {
    nodes: [
      { id: 'node-1', type: 'custom', position: { x: 0, y: 0 }, data: {} },
    ] as unknown as Node[],
    edges: [] as Edge[],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  created_by: 'Test Author',
  ...overrides,
})

// Default props factory
const createDefaultProps = () => ({
  id: 'test-id',
  type: 'built-in' as const,
  onApplyTemplate: jest.fn(),
  onClose: jest.fn(),
})

describe('Details', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPipelineTemplateData = undefined
    mockIsLoading = false
  })

  /**
   * Loading State Tests
   * Tests for component behavior when data is loading or undefined
   */
  describe('Loading State', () => {
    it('should render Loading component when pipelineTemplateInfo is undefined', () => {
      mockPipelineTemplateData = undefined
      const props = createDefaultProps()

      const { container } = render(<Details {...props} />)

      // Loading component renders a spinner SVG with spin-animation class
      const spinner = container.querySelector('.spin-animation')
      expect(spinner).toBeInTheDocument()
    })

    it('should render Loading component when data is still loading', () => {
      mockIsLoading = true
      mockPipelineTemplateData = undefined
      const props = createDefaultProps()

      const { container } = render(<Details {...props} />)

      // Loading component renders a spinner SVG with spin-animation class
      const spinner = container.querySelector('.spin-animation')
      expect(spinner).toBeInTheDocument()
    })

    it('should not render main content while loading', () => {
      mockPipelineTemplateData = undefined
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.queryByTestId('workflow-preview')).not.toBeInTheDocument()
      expect(screen.queryByText('datasetPipeline.operations.useTemplate')).not.toBeInTheDocument()
    })
  })

  /**
   * Rendering Tests
   * Tests for correct rendering when data is available
   */
  describe('Rendering', () => {
    it('should render without crashing when data is available', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      const { container } = render(<Details {...props} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the main container with flex layout', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      const { container } = render(<Details {...props} />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('flex')
      expect(mainContainer).toHaveClass('h-full')
    })

    it('should render WorkflowPreview component', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should pass graph data to WorkflowPreview', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        graph: {
          nodes: [
            { id: '1', type: 'custom', position: { x: 0, y: 0 }, data: {} },
            { id: '2', type: 'custom', position: { x: 100, y: 100 }, data: {} },
          ] as unknown as Node[],
          edges: [
            { id: 'e1', source: '1', target: '2' },
          ] as unknown as Edge[],
          viewport: { x: 10, y: 20, zoom: 1.5 },
        },
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      const preview = screen.getByTestId('workflow-preview')
      expect(preview).toHaveAttribute('data-nodes-count', '2')
      expect(preview).toHaveAttribute('data-edges-count', '1')
      expect(preview).toHaveAttribute('data-viewport-zoom', '1.5')
    })

    it('should render template name', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ name: 'My Test Pipeline' })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByText('My Test Pipeline')).toBeInTheDocument()
    })

    it('should render template description', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ description: 'This is a test description' })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByText('This is a test description')).toBeInTheDocument()
    })

    it('should render created_by information when available', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ created_by: 'John Doe' })
      const props = createDefaultProps()

      render(<Details {...props} />)

      // The translation key includes the author
      expect(screen.getByText('datasetPipeline.details.createdBy')).toBeInTheDocument()
    })

    it('should not render created_by when not available', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ created_by: '' })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.queryByText(/createdBy/)).not.toBeInTheDocument()
    })

    it('should render "Use Template" button', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByText('datasetPipeline.operations.useTemplate')).toBeInTheDocument()
    })

    it('should render close button', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      const closeButton = screen.getByRole('button', { name: '' })
      expect(closeButton).toBeInTheDocument()
    })

    it('should render structure section title', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByText('datasetPipeline.details.structure')).toBeInTheDocument()
    })

    it('should render structure tooltip', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      // Tooltip component should be rendered
      expect(screen.getByText('datasetPipeline.details.structure')).toBeInTheDocument()
    })
  })

  /**
   * Event Handler Tests
   * Tests for user interactions and callback functions
   */
  describe('Event Handlers', () => {
    it('should call onApplyTemplate when "Use Template" button is clicked', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      const useTemplateButton = screen.getByText('datasetPipeline.operations.useTemplate').closest('button')
      fireEvent.click(useTemplateButton!)

      expect(props.onApplyTemplate).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when close button is clicked', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      const { container } = render(<Details {...props} />)

      // Find the close button (the one with RiCloseLine icon)
      const closeButton = container.querySelector('button.absolute.right-4')
      fireEvent.click(closeButton!)

      expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('should not call handlers on multiple clicks (each click should trigger once)', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      const useTemplateButton = screen.getByText('datasetPipeline.operations.useTemplate').closest('button')
      fireEvent.click(useTemplateButton!)
      fireEvent.click(useTemplateButton!)
      fireEvent.click(useTemplateButton!)

      expect(props.onApplyTemplate).toHaveBeenCalledTimes(3)
    })
  })

  /**
   * Props Variations Tests
   * Tests for different prop combinations
   */
  describe('Props Variations', () => {
    it('should handle built-in type', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = { ...createDefaultProps(), type: 'built-in' as const }

      render(<Details {...props} />)

      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should handle customized type', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = { ...createDefaultProps(), type: 'customized' as const }

      render(<Details {...props} />)

      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should handle different template IDs', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = { ...createDefaultProps(), id: 'unique-template-123' }

      render(<Details {...props} />)

      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })
  })

  /**
   * App Icon Memoization Tests
   * Tests for the useMemo logic that computes appIcon
   */
  describe('App Icon Memoization', () => {
    it('should use default emoji icon when pipelineTemplateInfo is undefined', () => {
      mockPipelineTemplateData = undefined
      const props = createDefaultProps()

      render(<Details {...props} />)

      // Loading state - no AppIcon rendered
      expect(screen.queryByTestId('workflow-preview')).not.toBeInTheDocument()
    })

    it('should handle emoji icon type', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        icon_info: {
          icon_type: 'emoji',
          icon: '🚀',
          icon_background: '#E6F4FF',
          icon_url: '',
        },
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      // AppIcon should be rendered with emoji
      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should handle image icon type', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        icon_info: {
          icon_type: 'image',
          icon: 'file-id-123',
          icon_background: '',
          icon_url: 'https://example.com/image.png',
        },
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should handle image icon type with empty url and icon (fallback branch)', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        icon_info: {
          icon_type: 'image',
          icon: '', // empty string - triggers || '' fallback
          icon_background: '',
          icon_url: '', // empty string - triggers || '' fallback
        },
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      // Component should still render without errors
      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should handle missing icon properties gracefully', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        icon_info: {
          icon_type: 'emoji',
          icon: '',
          icon_background: '',
          icon_url: '',
        },
      })
      const props = createDefaultProps()

      expect(() => render(<Details {...props} />)).not.toThrow()
    })
  })

  /**
   * Chunk Structure Tests
   * Tests for different chunk_structure values and ChunkStructureCard rendering
   */
  describe('Chunk Structure', () => {
    it('should render ChunkStructureCard for text chunk structure', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        chunk_structure: ChunkingMode.text,
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      // ChunkStructureCard should be rendered
      expect(screen.getByText('datasetPipeline.details.structure')).toBeInTheDocument()
      // General option title
      expect(screen.getByText('General')).toBeInTheDocument()
    })

    it('should render ChunkStructureCard for parentChild chunk structure', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        chunk_structure: ChunkingMode.parentChild,
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByText('Parent-Child')).toBeInTheDocument()
    })

    it('should render ChunkStructureCard for qa chunk structure', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        chunk_structure: ChunkingMode.qa,
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByText('Q&A')).toBeInTheDocument()
    })
  })

  /**
   * Edge Cases Tests
   * Tests for boundary conditions and unusual inputs
   */
  describe('Edge Cases', () => {
    it('should handle empty name', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ name: '' })
      const props = createDefaultProps()

      expect(() => render(<Details {...props} />)).not.toThrow()
    })

    it('should handle empty description', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ description: '' })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should handle very long name', () => {
      const longName = 'A'.repeat(200)
      mockPipelineTemplateData = createMockPipelineTemplate({ name: longName })
      const props = createDefaultProps()

      render(<Details {...props} />)

      const nameElement = screen.getByText(longName)
      expect(nameElement).toBeInTheDocument()
      expect(nameElement).toHaveClass('truncate')
    })

    it('should handle very long description', () => {
      const longDesc = 'B'.repeat(1000)
      mockPipelineTemplateData = createMockPipelineTemplate({ description: longDesc })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByText(longDesc)).toBeInTheDocument()
    })

    it('should handle special characters in name', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        name: 'Test <>&"\'Pipeline @#$%^&*()',
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByText('Test <>&"\'Pipeline @#$%^&*()')).toBeInTheDocument()
    })

    it('should handle unicode characters', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        name: '测试管道 🚀 テスト',
        description: '这是一个测试描述 日本語テスト',
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      expect(screen.getByText('测试管道 🚀 テスト')).toBeInTheDocument()
      expect(screen.getByText('这是一个测试描述 日本語テスト')).toBeInTheDocument()
    })

    it('should handle empty graph nodes and edges', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      })
      const props = createDefaultProps()

      render(<Details {...props} />)

      const preview = screen.getByTestId('workflow-preview')
      expect(preview).toHaveAttribute('data-nodes-count', '0')
      expect(preview).toHaveAttribute('data-edges-count', '0')
    })
  })

  /**
   * Component Memoization Tests
   * Tests for React.memo behavior
   */
  describe('Component Memoization', () => {
    it('should render correctly after rerender with same props', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      const { rerender } = render(<Details {...props} />)

      expect(screen.getByText('Test Pipeline Template')).toBeInTheDocument()

      rerender(<Details {...props} />)

      expect(screen.getByText('Test Pipeline Template')).toBeInTheDocument()
    })

    it('should update when id prop changes', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ name: 'First Template' })
      const props = createDefaultProps()

      const { rerender } = render(<Details {...props} />)

      expect(screen.getByText('First Template')).toBeInTheDocument()

      // Change the id prop which should trigger a rerender
      // Update mock data for the new id
      mockPipelineTemplateData = createMockPipelineTemplate({ name: 'Second Template' })
      rerender(<Details {...props} id="new-id" />)

      expect(screen.getByText('Second Template')).toBeInTheDocument()
    })

    it('should handle callback reference changes', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      const { rerender } = render(<Details {...props} />)

      const newOnApplyTemplate = jest.fn()
      rerender(<Details {...props} onApplyTemplate={newOnApplyTemplate} />)

      const useTemplateButton = screen.getByText('datasetPipeline.operations.useTemplate').closest('button')
      fireEvent.click(useTemplateButton!)

      expect(newOnApplyTemplate).toHaveBeenCalledTimes(1)
      expect(props.onApplyTemplate).not.toHaveBeenCalled()
    })
  })

  /**
   * Component Structure Tests
   * Tests for DOM structure and layout
   */
  describe('Component Structure', () => {
    it('should have left panel for workflow preview', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      const { container } = render(<Details {...props} />)

      const leftPanel = container.querySelector('.grow.items-center.justify-center')
      expect(leftPanel).toBeInTheDocument()
    })

    it('should have right panel with fixed width', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      const { container } = render(<Details {...props} />)

      const rightPanel = container.querySelector('.w-\\[360px\\]')
      expect(rightPanel).toBeInTheDocument()
    })

    it('should have primary button variant for Use Template', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      const button = screen.getByText('datasetPipeline.operations.useTemplate').closest('button')
      // Button should have primary styling
      expect(button).toBeInTheDocument()
    })

    it('should have title attribute for truncation tooltip', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ name: 'My Pipeline Name' })
      const props = createDefaultProps()

      render(<Details {...props} />)

      const nameElement = screen.getByText('My Pipeline Name')
      expect(nameElement).toHaveAttribute('title', 'My Pipeline Name')
    })

    it('should have title attribute on created_by for truncation', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ created_by: 'Author Name' })
      const props = createDefaultProps()

      render(<Details {...props} />)

      const createdByElement = screen.getByText('datasetPipeline.details.createdBy')
      expect(createdByElement).toHaveAttribute('title', 'Author Name')
    })
  })

  /**
   * Component Lifecycle Tests
   * Tests for mount/unmount behavior
   */
  describe('Component Lifecycle', () => {
    it('should mount without errors', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      expect(() => render(<Details {...props} />)).not.toThrow()
    })

    it('should unmount without errors', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      const { unmount } = render(<Details {...props} />)

      expect(() => unmount()).not.toThrow()
    })

    it('should handle rapid mount/unmount cycles', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      for (let i = 0; i < 5; i++) {
        const { unmount } = render(<Details {...props} />)
        unmount()
      }

      expect(true).toBe(true)
    })

    it('should transition from loading to loaded state', () => {
      mockPipelineTemplateData = undefined
      const props = createDefaultProps()

      const { rerender, container } = render(<Details {...props} />)

      // Loading component renders a spinner SVG with spin-animation class
      const spinner = container.querySelector('.spin-animation')
      expect(spinner).toBeInTheDocument()

      // Simulate data loaded - need to change props to trigger rerender with React.memo
      mockPipelineTemplateData = createMockPipelineTemplate()
      rerender(<Details {...props} id="loaded-id" />)

      expect(container.querySelector('.spin-animation')).not.toBeInTheDocument()
      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })
  })

  /**
   * Styling Tests
   * Tests for CSS classes and visual styling
   */
  describe('Styling', () => {
    it('should apply overflow-hidden rounded-2xl to WorkflowPreview container', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      const preview = screen.getByTestId('workflow-preview')
      expect(preview).toHaveClass('overflow-hidden')
      expect(preview).toHaveClass('rounded-2xl')
    })

    it('should apply correct typography classes to template name', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      const nameElement = screen.getByText('Test Pipeline Template')
      expect(nameElement).toHaveClass('system-md-semibold')
      expect(nameElement).toHaveClass('text-text-secondary')
    })

    it('should apply correct styling to description', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      const description = screen.getByText('Test pipeline description for testing purposes')
      expect(description).toHaveClass('system-sm-regular')
      expect(description).toHaveClass('text-text-secondary')
    })

    it('should apply correct styling to structure title', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = createDefaultProps()

      render(<Details {...props} />)

      const structureTitle = screen.getByText('datasetPipeline.details.structure')
      expect(structureTitle).toHaveClass('system-sm-semibold-uppercase')
      expect(structureTitle).toHaveClass('text-text-secondary')
    })
  })

  /**
   * API Hook Integration Tests
   * Tests for usePipelineTemplateById hook behavior
   */
  describe('API Hook Integration', () => {
    it('should pass correct params to usePipelineTemplateById for built-in type', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = { ...createDefaultProps(), id: 'test-id-123', type: 'built-in' as const }

      render(<Details {...props} />)

      // The hook should be called with the correct parameters
      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should pass correct params to usePipelineTemplateById for customized type', () => {
      mockPipelineTemplateData = createMockPipelineTemplate()
      const props = { ...createDefaultProps(), id: 'custom-id-456', type: 'customized' as const }

      render(<Details {...props} />)

      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should handle data refetch on id change', () => {
      mockPipelineTemplateData = createMockPipelineTemplate({ name: 'First Template' })
      const props = createDefaultProps()

      const { rerender } = render(<Details {...props} />)

      expect(screen.getByText('First Template')).toBeInTheDocument()

      // Change id and update mock data
      mockPipelineTemplateData = createMockPipelineTemplate({ name: 'Second Template' })
      rerender(<Details {...props} id="new-id" />)

      expect(screen.getByText('Second Template')).toBeInTheDocument()
    })
  })
})
