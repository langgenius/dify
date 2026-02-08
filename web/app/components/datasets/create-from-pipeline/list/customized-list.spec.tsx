import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CustomizedList from './customized-list'

// Mock TemplateCard
vi.mock('./template-card', () => ({
  default: ({ type, pipeline }: { type: string, pipeline: { name: string } }) => (
    <div data-testid="template-card" data-type={type}>
      {pipeline.name}
    </div>
  ),
}))

// Mock usePipelineTemplateList hook
const mockUsePipelineTemplateList = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  usePipelineTemplateList: (...args: unknown[]) => mockUsePipelineTemplateList(...args),
}))

// ============================================================================
// CustomizedList Component Tests
// ============================================================================

describe('CustomizedList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Loading State Tests
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should return null when loading', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: null,
        isLoading: true,
      })

      const { container } = render(<CustomizedList />)
      expect(container.firstChild).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // Empty State Tests
  // --------------------------------------------------------------------------
  describe('Empty State', () => {
    it('should return null when list is empty', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: [] },
        isLoading: false,
      })

      const { container } = render(<CustomizedList />)
      expect(container.firstChild).toBeNull()
    })

    it('should return null when data is undefined', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: undefined,
        isLoading: false,
      })

      const { container } = render(<CustomizedList />)
      expect(container.firstChild).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // Rendering with Data Tests
  // --------------------------------------------------------------------------
  describe('Rendering with Data', () => {
    it('should render title when list has items', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: {
          pipeline_templates: [
            { name: 'Pipeline 1' },
          ],
        },
        isLoading: false,
      })

      render(<CustomizedList />)
      expect(screen.getByText(/customized/i)).toBeInTheDocument()
    })

    it('should render TemplateCard for each pipeline', () => {
      const mockPipelines = [
        { name: 'Pipeline 1' },
        { name: 'Pipeline 2' },
        { name: 'Pipeline 3' },
      ]
      mockUsePipelineTemplateList.mockReturnValue({
        data: { pipeline_templates: mockPipelines },
        isLoading: false,
      })

      render(<CustomizedList />)
      const cards = screen.getAllByTestId('template-card')
      expect(cards).toHaveLength(3)
    })

    it('should pass correct props to TemplateCard', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: {
          pipeline_templates: [{ name: 'Test Pipeline' }],
        },
        isLoading: false,
      })

      render(<CustomizedList />)
      const card = screen.getByTestId('template-card')
      expect(card).toHaveAttribute('data-type', 'customized')
      expect(card).toHaveTextContent('Test Pipeline')
    })
  })

  // --------------------------------------------------------------------------
  // API Call Tests
  // --------------------------------------------------------------------------
  describe('API Call', () => {
    it('should call usePipelineTemplateList with type customized', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: null,
        isLoading: true,
      })

      render(<CustomizedList />)
      expect(mockUsePipelineTemplateList).toHaveBeenCalledWith({ type: 'customized' })
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have grid layout for cards', () => {
      mockUsePipelineTemplateList.mockReturnValue({
        data: {
          pipeline_templates: [{ name: 'Pipeline 1' }],
        },
        isLoading: false,
      })

      const { container } = render(<CustomizedList />)
      const grid = container.querySelector('.grid')
      expect(grid).toHaveClass('grid-cols-1', 'gap-3', 'py-2')
    })
  })
})
