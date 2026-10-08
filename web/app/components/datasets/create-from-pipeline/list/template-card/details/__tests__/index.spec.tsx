import type { ReactElement, ReactNode } from 'react'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import Details from '../index'

// Mock WorkflowPreview
vi.mock('@/app/components/workflow/workflow-preview', () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="workflow-preview" className={className}>
      WorkflowPreview
    </div>
  ),
}))

const mockUsePipelineTemplateById = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  usePipelineTemplateById: (...args: unknown[]) => mockUsePipelineTemplateById(...args),
}))

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

function DetailsDialog({ children }: { children: ReactNode }) {
  return (
    <Dialog defaultOpen>
      <DialogContent>{children}</DialogContent>
    </Dialog>
  )
}

const renderDetails = (element: ReactElement) => render(element, { wrapper: DetailsDialog })

// Details Component Tests

describe('Details', () => {
  const defaultProps = {
    id: 'pipeline-1',
    type: 'customized' as const,
    onApplyTemplate: vi.fn(),
    name: 'Loading Pipeline',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Loading State Tests
  describe('Loading State', () => {
    it('keeps the dialog named and closable while the template is loading', async () => {
      const user = userEvent.setup()
      mockUsePipelineTemplateById.mockReturnValue({
        data: null,
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByRole('dialog', { name: 'Loading Pipeline' })).toBeInTheDocument()
      expect(screen.queryByText('Test Pipeline')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  describe('Rendering', () => {
    it('should render pipeline name', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should render pipeline description', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText('This is a test pipeline')).toBeInTheDocument()
    })

    it('should render created by when available', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.createdBy/i)).toBeInTheDocument()
    })

    it('should not render created by when not available', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo({ created_by: '' }),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.queryByText(/details\.createdBy/i)).not.toBeInTheDocument()
    })

    it('should render use template button', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText(/operations\.useTemplate/i)).toBeInTheDocument()
    })

    it('should render structure section', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })

    it('should render close button', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })

    it('should render workflow preview', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
    })

    it('should render tooltip for structure', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      // Tooltip component should be present
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('closes the dialog when the close button is clicked', async () => {
      const user = userEvent.setup()
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByRole('dialog', { name: 'Test Pipeline' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('should call onApplyTemplate when use template button is clicked', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      const useButton = screen.getByText(/operations\.useTemplate/i).closest('button')
      fireEvent.click(useButton!)

      expect(defaultProps.onApplyTemplate).toHaveBeenCalledTimes(1)
    })
  })

  // Icon Types Tests
  describe('Icon Types', () => {
    it('should handle emoji icon type', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should handle image icon type', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createImageIconPipelineInfo(),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('shows the loading state when template data is absent', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: null,
      })

      renderDetails(<Details {...defaultProps} />)

      expect(screen.queryByText('Test Pipeline')).not.toBeInTheDocument()
    })
  })

  // API Call Tests
  describe('API Call', () => {
    it('should call usePipelineTemplateById with correct params', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} />)

      expect(mockUsePipelineTemplateById).toHaveBeenCalledWith(
        { template_id: 'pipeline-1', type: 'customized' },
        true,
      )
    })

    it('should call usePipelineTemplateById with built-in type', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      renderDetails(<Details {...defaultProps} type="built-in" />)

      expect(mockUsePipelineTemplateById).toHaveBeenCalledWith(
        { template_id: 'pipeline-1', type: 'built-in' },
        true,
      )
    })
  })

  // Chunk Structure Tests
  describe('Chunk Structure', () => {
    it('should render chunk structure card for text mode', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo({ chunk_structure: 'text' }),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })

    it('should render chunk structure card for parent-child mode', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo({ chunk_structure: 'hierarchical' }),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })

    it('should render chunk structure card for qa mode', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo({ chunk_structure: 'qa' }),
      })

      renderDetails(<Details {...defaultProps} />)
      expect(screen.getByText(/details\.structure/i)).toBeInTheDocument()
    })
  })

  describe('Layout', () => {
    it('should have fixed width sidebar', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      const { baseElement: container } = renderDetails(<Details {...defaultProps} />)
      const sidebar = container.querySelector('.w-90')
      expect(sidebar).toBeInTheDocument()
    })

    it('should have workflow preview container with grow class', () => {
      mockUsePipelineTemplateById.mockReturnValue({
        data: createPipelineTemplateInfo(),
      })

      const { baseElement: container } = renderDetails(<Details {...defaultProps} />)
      const previewContainer = container.querySelector('[class*="grow"]')
      expect(previewContainer).toBeInTheDocument()
    })
  })
})
