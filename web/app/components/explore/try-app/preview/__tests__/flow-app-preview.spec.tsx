import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FlowAppPreview from '../flow-app-preview'

const mockUseGetTryAppFlowPreview = vi.fn()

vi.mock('@/service/use-try-app', () => ({
  useGetTryAppFlowPreview: (...args: unknown[]) => mockUseGetTryAppFlowPreview(...args),
}))

vi.mock('@/app/components/workflow/workflow-preview', () => ({
  default: ({
    className,
    miniMapToRight,
    nodes,
    edges,
  }: { className?: string, miniMapToRight?: boolean, nodes?: unknown[], edges?: unknown[] }) => (
    <div
      data-testid="workflow-preview"
      className={className}
      data-mini-map-to-right={miniMapToRight}
      data-nodes-count={nodes?.length}
      data-edges-count={edges?.length}
    >
      WorkflowPreview
    </div>
  ),
}))

describe('FlowAppPreview', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('renders Loading component when isLoading is true', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: null,
        isLoading: true,
      })

      render(<FlowAppPreview appId="test-app-id" />)

      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.queryByTestId('workflow-preview')).not.toBeInTheDocument()
    })
  })

  describe('no data state', () => {
    it('returns null when data is null', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: null,
        isLoading: false,
      })

      const { container } = render(<FlowAppPreview appId="test-app-id" />)

      expect(container.firstChild).toBeNull()
    })

    it('returns null when data is undefined', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: undefined,
        isLoading: false,
      })

      const { container } = render(<FlowAppPreview appId="test-app-id" />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('data loaded state', () => {
    it('renders WorkflowPreview when data is loaded', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: {
          graph: {
            nodes: [{ id: 'node1' }],
            edges: [{ id: 'edge1' }],
          },
        },
        isLoading: false,
      })

      render(<FlowAppPreview appId="test-app-id" />)

      expect(screen.getByTestId('workflow-preview')).toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('passes graph data to WorkflowPreview', () => {
      const mockNodes = [{ id: 'node1' }, { id: 'node2' }, { id: 'node3' }]
      const mockEdges = [{ id: 'edge1' }, { id: 'edge2' }]

      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: {
          graph: {
            nodes: mockNodes,
            edges: mockEdges,
          },
        },
        isLoading: false,
      })

      render(<FlowAppPreview appId="test-app-id" />)

      const workflowPreview = screen.getByTestId('workflow-preview')
      expect(workflowPreview).toHaveAttribute('data-nodes-count', '3')
      expect(workflowPreview).toHaveAttribute('data-edges-count', '2')
    })

    it('passes miniMapToRight=true to WorkflowPreview', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: {
          graph: {
            nodes: [],
            edges: [],
          },
        },
        isLoading: false,
      })

      render(<FlowAppPreview appId="test-app-id" />)

      const workflowPreview = screen.getByTestId('workflow-preview')
      expect(workflowPreview).toHaveAttribute('data-mini-map-to-right', 'true')
    })

    it('passes className to WorkflowPreview', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: {
          graph: {
            nodes: [],
            edges: [],
          },
        },
        isLoading: false,
      })

      render(<FlowAppPreview appId="test-app-id" className="custom-class" />)

      const workflowPreview = screen.getByTestId('workflow-preview')
      expect(workflowPreview).toHaveClass('custom-class')
    })
  })

  describe('hook calls', () => {
    it('calls useGetTryAppFlowPreview with correct appId', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: null,
        isLoading: true,
      })

      render(<FlowAppPreview appId="my-specific-app-id" />)

      expect(mockUseGetTryAppFlowPreview).toHaveBeenCalledWith('my-specific-app-id')
    })
  })

  describe('wrapper styling', () => {
    it('renders with correct wrapper classes when data is loaded', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: {
          graph: {
            nodes: [],
            edges: [],
          },
        },
        isLoading: false,
      })

      const { container } = render(<FlowAppPreview appId="test-app-id" />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('h-full', 'w-full')
    })
  })
})
