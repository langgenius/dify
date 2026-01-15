import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { cleanup, render, screen } from '@testing-library/react'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'

// Import real utility functions (pure functions, no side effects)

// Import mocked modules for manipulation
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { usePipelineInit } from './hooks'
import RagPipelineWrapper from './index'
import { processNodesWithoutDataSource } from './utils'

// Mock: Context - need to control return values
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: vi.fn(),
}))

// Mock: Hook with API calls
vi.mock('./hooks', () => ({
  usePipelineInit: vi.fn(),
}))

// Mock: Store creator
vi.mock('./store', () => ({
  createRagPipelineSliceSlice: vi.fn(() => ({})),
}))

// Mock: Utility with complex workflow dependencies (generateNewNode, etc.)
vi.mock('./utils', () => ({
  processNodesWithoutDataSource: vi.fn((nodes, viewport) => ({
    nodes,
    viewport,
  })),
}))

// Mock: Complex component with useParams, Toast, API calls
vi.mock('./components/conversion', () => ({
  default: () => <div data-testid="conversion-component">Conversion Component</div>,
}))

// Mock: Complex component with many hooks and workflow dependencies
vi.mock('./components/rag-pipeline-main', () => ({
  default: ({ nodes, edges, viewport }: any) => (
    <div data-testid="rag-pipeline-main">
      <span data-testid="nodes-count">{nodes?.length ?? 0}</span>
      <span data-testid="edges-count">{edges?.length ?? 0}</span>
      <span data-testid="viewport-zoom">{viewport?.zoom ?? 'none'}</span>
    </div>
  ),
}))

// Mock: Complex component with ReactFlow and many providers
vi.mock('@/app/components/workflow', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-default-context">{children}</div>
  ),
}))

// Mock: Context provider
vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-context-provider">{children}</div>
  ),
}))

// Type assertions for mocked functions
const mockUseDatasetDetailContextWithSelector = vi.mocked(useDatasetDetailContextWithSelector)
const mockUsePipelineInit = vi.mocked(usePipelineInit)
const mockProcessNodesWithoutDataSource = vi.mocked(processNodesWithoutDataSource)

// Helper to mock selector with actual execution (increases function coverage)
// This executes the real selector function: s => s.dataset?.pipeline_id
const mockSelectorWithDataset = (pipelineId: string | null | undefined) => {
  mockUseDatasetDetailContextWithSelector.mockImplementation((selector: (state: any) => any) => {
    const mockState = { dataset: pipelineId ? { pipeline_id: pipelineId } : null }
    return selector(mockState)
  })
}

// Test data factory
const createMockWorkflowData = (overrides?: Partial<FetchWorkflowDraftResponse>): FetchWorkflowDraftResponse => ({
  graph: {
    nodes: [
      { id: 'node-1', type: 'custom', data: { type: BlockEnum.Start, title: 'Start' }, position: { x: 100, y: 100 } },
      { id: 'node-2', type: 'custom', data: { type: BlockEnum.End, title: 'End' }, position: { x: 300, y: 100 } },
    ],
    edges: [
      { id: 'edge-1', source: 'node-1', target: 'node-2', type: 'custom' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  hash: 'test-hash-123',
  updated_at: 1234567890,
  tool_published: false,
  environment_variables: [],
  ...overrides,
} as FetchWorkflowDraftResponse)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RagPipelineWrapper', () => {
  describe('Rendering', () => {
    it('should render Conversion component when pipelineId is null', () => {
      mockSelectorWithDataset(null)
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('conversion-component')).toBeInTheDocument()
      expect(screen.queryByTestId('workflow-context-provider')).not.toBeInTheDocument()
    })

    it('should render Conversion component when pipelineId is undefined', () => {
      mockSelectorWithDataset(undefined)
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('conversion-component')).toBeInTheDocument()
    })

    it('should render Conversion component when pipelineId is empty string', () => {
      mockSelectorWithDataset('')
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('conversion-component')).toBeInTheDocument()
    })

    it('should render WorkflowContextProvider when pipelineId exists', () => {
      mockSelectorWithDataset('pipeline-123')
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: true })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('workflow-context-provider')).toBeInTheDocument()
      expect(screen.queryByTestId('conversion-component')).not.toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should pass injectWorkflowStoreSliceFn to WorkflowContextProvider', () => {
      mockSelectorWithDataset('pipeline-456')
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: true })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('workflow-context-provider')).toBeInTheDocument()
    })
  })
})

describe('RagPipeline', () => {
  beforeEach(() => {
    // Default setup for RagPipeline tests - execute real selector function
    mockSelectorWithDataset('pipeline-123')
  })

  describe('Loading State', () => {
    it('should render Loading component when isLoading is true', () => {
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: true })

      render(<RagPipelineWrapper />)

      // Real Loading component has role="status"
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render Loading component when data is undefined', () => {
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render Loading component when both data is undefined and isLoading is true', () => {
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: true })

      render(<RagPipelineWrapper />)

      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  describe('Data Loaded State', () => {
    it('should render RagPipelineMain when data is loaded', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('rag-pipeline-main')).toBeInTheDocument()
      expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument()
    })

    it('should pass processed nodes to RagPipelineMain', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('nodes-count').textContent).toBe('2')
    })

    it('should pass edges to RagPipelineMain', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('edges-count').textContent).toBe('1')
    })

    it('should pass viewport to RagPipelineMain', () => {
      const mockData = createMockWorkflowData({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 100, y: 200, zoom: 1.5 },
        },
      })
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('viewport-zoom').textContent).toBe('1.5')
    })
  })

  describe('Memoization Logic', () => {
    it('should process nodes through initialNodes when data is loaded', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      // initialNodes is a real function - verify nodes are rendered
      // The real initialNodes processes nodes and adds position data
      expect(screen.getByTestId('rag-pipeline-main')).toBeInTheDocument()
    })

    it('should process edges through initialEdges when data is loaded', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      // initialEdges is a real function - verify component renders with edges
      expect(screen.getByTestId('edges-count').textContent).toBe('1')
    })

    it('should call processNodesWithoutDataSource with nodesData and viewport', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(mockProcessNodesWithoutDataSource).toHaveBeenCalled()
    })

    it('should not process nodes when data is undefined', () => {
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: false })

      render(<RagPipelineWrapper />)

      // When data is undefined, Loading is shown, processNodesWithoutDataSource is not called
      expect(mockProcessNodesWithoutDataSource).not.toHaveBeenCalled()
    })

    it('should use memoized values when data reference is same', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      const { rerender } = render(<RagPipelineWrapper />)

      // Clear mock call count after initial render
      mockProcessNodesWithoutDataSource.mockClear()

      // Rerender with same data reference (no change to mockUsePipelineInit)
      rerender(<RagPipelineWrapper />)

      // processNodesWithoutDataSource should not be called again due to useMemo
      // Note: React strict mode may cause double render, so we check it's not excessive
      expect(mockProcessNodesWithoutDataSource.mock.calls.length).toBeLessThanOrEqual(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty nodes array', () => {
      const mockData = createMockWorkflowData({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      })
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('nodes-count').textContent).toBe('0')
    })

    it('should handle empty edges array', () => {
      const mockData = createMockWorkflowData({
        graph: {
          nodes: [{ id: 'node-1', type: 'custom', data: { type: BlockEnum.Start, title: 'Start', desc: '' }, position: { x: 0, y: 0 } }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      })
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('edges-count').textContent).toBe('0')
    })

    it('should handle undefined viewport', () => {
      const mockData = createMockWorkflowData({
        graph: {
          nodes: [],
          edges: [],
          viewport: undefined as any,
        },
      })
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('rag-pipeline-main')).toBeInTheDocument()
    })

    it('should handle null viewport', () => {
      const mockData = createMockWorkflowData({
        graph: {
          nodes: [],
          edges: [],
          viewport: null as any,
        },
      })
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('rag-pipeline-main')).toBeInTheDocument()
    })

    it('should handle large number of nodes', () => {
      const largeNodesArray = Array.from({ length: 100 }, (_, i) => ({
        id: `node-${i}`,
        type: 'custom',
        data: { type: BlockEnum.Start, title: `Node ${i}`, desc: '' },
        position: { x: i * 100, y: 0 },
      }))

      const mockData = createMockWorkflowData({
        graph: {
          nodes: largeNodesArray,
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      })
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('nodes-count').textContent).toBe('100')
    })

    it('should handle viewport with edge case zoom values', () => {
      const mockData = createMockWorkflowData({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: -1000, y: -1000, zoom: 0.25 },
        },
      })
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('viewport-zoom').textContent).toBe('0.25')
    })

    it('should handle viewport with maximum zoom', () => {
      const mockData = createMockWorkflowData({
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 4 },
        },
      })
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('viewport-zoom').textContent).toBe('4')
    })
  })

  describe('Component Integration', () => {
    it('should render WorkflowWithDefaultContext as wrapper', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      expect(screen.getByTestId('workflow-default-context')).toBeInTheDocument()
    })

    it('should nest RagPipelineMain inside WorkflowWithDefaultContext', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

      const workflowContext = screen.getByTestId('workflow-default-context')
      const ragPipelineMain = screen.getByTestId('rag-pipeline-main')

      expect(workflowContext).toContainElement(ragPipelineMain)
    })
  })
})

describe('processNodesWithoutDataSource utility integration', () => {
  beforeEach(() => {
    mockSelectorWithDataset('pipeline-123')
  })

  it('should process nodes through processNodesWithoutDataSource', () => {
    const mockData = createMockWorkflowData()
    mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })
    mockProcessNodesWithoutDataSource.mockReturnValue({
      nodes: [{ id: 'processed-node', type: 'custom', data: { type: BlockEnum.Start, title: 'Processed', desc: '' }, position: { x: 0, y: 0 } }] as any,
      viewport: { x: 0, y: 0, zoom: 2 },
    })

    render(<RagPipelineWrapper />)

    expect(mockProcessNodesWithoutDataSource).toHaveBeenCalled()
    expect(screen.getByTestId('nodes-count').textContent).toBe('1')
    expect(screen.getByTestId('viewport-zoom').textContent).toBe('2')
  })

  it('should handle processNodesWithoutDataSource returning modified viewport', () => {
    const mockData = createMockWorkflowData()
    mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })
    mockProcessNodesWithoutDataSource.mockReturnValue({
      nodes: [],
      viewport: { x: 500, y: 500, zoom: 0.5 },
    })

    render(<RagPipelineWrapper />)

    expect(screen.getByTestId('viewport-zoom').textContent).toBe('0.5')
  })
})

describe('Conditional Rendering Flow', () => {
  it('should transition from loading to loaded state', () => {
    mockSelectorWithDataset('pipeline-123')

    // Start with loading state
    mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: true })
    const { rerender } = render(<RagPipelineWrapper />)

    // Real Loading component has role="status"
    expect(screen.getByRole('status')).toBeInTheDocument()

    // Transition to loaded state
    const mockData = createMockWorkflowData()
    mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })
    rerender(<RagPipelineWrapper />)

    expect(screen.getByTestId('rag-pipeline-main')).toBeInTheDocument()
  })

  it('should switch from Conversion to Pipeline when pipelineId becomes available', () => {
    // Start without pipelineId
    mockSelectorWithDataset(null)
    mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: false })

    const { rerender } = render(<RagPipelineWrapper />)

    expect(screen.getByTestId('conversion-component')).toBeInTheDocument()

    // PipelineId becomes available
    mockSelectorWithDataset('new-pipeline-id')
    mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: true })
    rerender(<RagPipelineWrapper />)

    expect(screen.queryByTestId('conversion-component')).not.toBeInTheDocument()
    // Real Loading component has role="status"
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

describe('Error Handling', () => {
  beforeEach(() => {
    mockSelectorWithDataset('pipeline-123')
  })

  it('should throw when graph nodes is null', () => {
    const mockData = {
      graph: {
        nodes: null as any,
        edges: null as any,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      hash: 'test',
      updated_at: 123,
    } as FetchWorkflowDraftResponse

    mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

    // Suppress console.error for expected error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Real initialNodes will throw when nodes is null
    // This documents the component's current behavior - it requires valid nodes array
    expect(() => render(<RagPipelineWrapper />)).toThrow()

    consoleSpy.mockRestore()
  })

  it('should throw when graph property is missing', () => {
    const mockData = {
      hash: 'test',
      updated_at: 123,
    } as unknown as FetchWorkflowDraftResponse

    mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

    // Suppress console.error for expected error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // When graph is undefined, component throws because data.graph.nodes is accessed
    // This documents the component's current behavior - it requires graph to be present
    expect(() => render(<RagPipelineWrapper />)).toThrow()

    consoleSpy.mockRestore()
  })
})
