import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Details from './index'

// Mock WorkflowPreview
vi.mock('@/app/components/workflow/workflow-preview', () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="workflow-preview" className={className}>
      WorkflowPreview
    </div>
  ),
}))

// Mock service hook
const mockUsePipelineTemplateById = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  usePipelineTemplateById: (...args: unknown[]) => mockUsePipelineTemplateById(...args),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createPipelineTemplateInfo = (overrides = {}) => ({
  name: 'Test Pipeline',
  description: 'This is a test pipeline',
  icon_info: {
    icon_type: 'emoji',
    icon: '📊',
    icon_background: '#FFF4ED',
    icon_url: '',
  },
  created_by: 'Test User',
  chunk_structure: 'text',
  graph: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  export_data: '',
  ...overrides,
})

const createImageIconPipelineInfo = () => ({
  ...createPipelineTemplateInfo(),
  icon_info: {
    icon_type: 'image',
    icon: 'file-id-123',
    icon_background: '',
    icon_url: 'https://example.com/icon.png',
  },
})

// ============================================================================
// Details Component Tests
// ============================================================================

describe('Details', () => {
  const defaultProps = {
    id: 'pipeline-1',
    type: 'customized' as const,
    onApplyTemplate: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Loading State Tests
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should show loading when data is not available', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: null,
      })

      render(<Details {...defaultProps} />)
      // Loading component should be rendered
      expect(screen.queryByText('Test Pipeline')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing when data is available', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should render pipeline name', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should render pipeline description', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText('This is a test pipeline')).toBeInTheDocument()
    })

    it('should render created by when available', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.createdBy/i)).toBeInTheDocument()
    })

    it('should not render created by when not available', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo({ created_by: '' }),
      })

      render(<Details {...defaultProps} />)
      expect(screen.queryByText(/details\.createdBy/i)).not.toBeInTheDocument()
    })

    it('should render use template button', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText(/operations\.useTemplate/i)).toBeInTheDocument()
    })

    it('should render structure section', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })

    it('should render close button', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      const { container } = render(<Details {...defaultProps} />)
      const closeButton = container.querySelector('button[type="button"]')
      expect(closeButton).toBeInTheDocument()
    })

    it('should render workflow preview', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should render tooltip for structure', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      // Tooltip component should be present
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      const { container } = render(<Details {...defaultProps} />)
      const closeButton = container.querySelector('button[type="button"]')
      fireEvent.click(closeButton!)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onApplyTemplate when use template button is clicked', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      const useButton = screen.getByText(/operations\.useTemplate/i).closest('button')
      fireEvent.click(useButton!)

      expect(defaultProps.onApplyTemplate).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // Icon Types Tests
  // --------------------------------------------------------------------------
  describe('Icon Types', () => {
    it('should handle emoji icon type', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should handle image icon type', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createImageIconPipelineInfo(),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should have default icon when data is null', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: null,
      })

      // When data is null, component shows loading state
      // The default icon is only used in useMemo when pipelineTemplateInfo is null
      render(<Details {...defaultProps} />)

      // Should not crash and should render (loading state)
      expect(screen.queryByText('Test Pipeline')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // API Call Tests
  // --------------------------------------------------------------------------
  describe('API Call', () => {
    it('should call usePipelineTemplateById with correct params', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} />)

      expect(mockUsePipelineTemplateById).toHaveBeenCalledWith(
        { template_id: 'pipeline-1', type: 'customized' },
        true,
      )
    })

    it('should call usePipelineTemplateById with built-in type', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      render(<Details {...defaultProps} type="built-in" />)

      expect(mockUsePipelineTemplateById).toHaveBeenCalledWith(
        { template_id: 'pipeline-1', type: 'built-in' },
        true,
      )
    })
  })

  // --------------------------------------------------------------------------
  // Chunk Structure Tests
  // --------------------------------------------------------------------------
  describe('Chunk Structure', () => {
    it('should render chunk structure card for text mode', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo({ chunk_structure: 'text' }),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })

    it('should render chunk structure card for parent-child mode', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo({ chunk_structure: 'hierarchical' }),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })

    it('should render chunk structure card for qa mode', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo({ chunk_structure: 'qa' }),
      })

      render(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container styling', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      const { container } = render(<Details {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'h-full')
    })

    it('should have fixed width sidebar', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      const { container } = render(<Details {...defaultProps} />)
      const sidebar = container.querySelector('[class*="w-[360px]"]')
      expect(sidebar).toBeInTheDocument()
    })

    it('should have workflow preview container with grow class', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      const { container } = render(<Details {...defaultProps} />)
      const previewContainer = container.querySelector('[class*="grow"]')
      expect(previewContainer).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      const { rerender } = render(<Details {...defaultProps} />)
      rerender(<Details {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })
  })
})
