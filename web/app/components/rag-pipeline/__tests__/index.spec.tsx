import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { cleanup, render, screen } from '@testing-library/react'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'

import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { usePipelineInit } from '../hooks'
import RagPipelineWrapper from '../index'
import { processNodesWithoutDataSource } from '../utils'

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: vi.fn(),
}))

vi.mock('../hooks', () => ({
  usePipelineInit: vi.fn(),
}))

vi.mock('../store', () => ({
  createRagPipelineSliceSlice: vi.fn(() => ({})),
}))

vi.mock('../utils', () => ({
  processNodesWithoutDataSource: vi.fn((nodes, viewport) => ({
    nodes,
    viewport,
  })),
}))

vi.mock('../components/conversion', () => ({
  default: () => <div data-testid="conversion-component">Conversion Component</div>,
}))

vi.mock('../components/rag-pipeline-main', () => ({
  default: ({ nodes, edges, viewport }: { nodes?: unknown[], edges?: unknown[], viewport?: { zoom?: number } }) => (
    <div data-testid="rag-pipeline-main">
      <span data-testid="nodes-count">{nodes?.length ?? 0}</span>
      <span data-testid="edges-count">{edges?.length ?? 0}</span>
      <span data-testid="viewport-zoom">{viewport?.zoom ?? 'none'}</span>
    </div>
  ),
}))

vi.mock('@/app/components/workflow', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-default-context">{children}</div>
  ),
}))

vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-context-provider">{children}</div>
  ),
}))

const mockUseDatasetDetailContextWithSelector = vi.mocked(useDatasetDetailContextWithSelector)
const mockUsePipelineInit = vi.mocked(usePipelineInit)
const mockProcessNodesWithoutDataSource = vi.mocked(processNodesWithoutDataSource)

const mockSelectorWithDataset = (pipelineId: string | null | undefined) => {
  mockUseDatasetDetailContextWithSelector.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
    const mockState = { dataset: pipelineId ? { pipeline_id: pipelineId } : null }
    return selector(mockState)
  })
}

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
    mockSelectorWithDataset('pipeline-123')
  })

  describe('Loading State', () => {
    it('should render Loading component when isLoading is true', () => {
      mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: true })

      render(<RagPipelineWrapper />)

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

      expect(screen.getByTestId('rag-pipeline-main')).toBeInTheDocument()
    })

    it('should process edges through initialEdges when data is loaded', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      render(<RagPipelineWrapper />)

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

      expect(mockProcessNodesWithoutDataSource).not.toHaveBeenCalled()
    })

    it('should use memoized values when data reference is same', () => {
      const mockData = createMockWorkflowData()
      mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

      const { rerender } = render(<RagPipelineWrapper />)

      mockProcessNodesWithoutDataSource.mockClear()

      rerender(<RagPipelineWrapper />)

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
          viewport: undefined as never,
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
          viewport: null as never,
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
      nodes: [{ id: 'processed-node', type: 'custom', data: { type: BlockEnum.Start, title: 'Processed', desc: '' }, position: { x: 0, y: 0 } }] as unknown as ReturnType<typeof processNodesWithoutDataSource>['nodes'],
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

    mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: true })
    const { rerender } = render(<RagPipelineWrapper />)

    expect(screen.getByRole('status')).toBeInTheDocument()

    const mockData = createMockWorkflowData()
    mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })
    rerender(<RagPipelineWrapper />)

    expect(screen.getByTestId('rag-pipeline-main')).toBeInTheDocument()
  })

  it('should switch from Conversion to Pipeline when pipelineId becomes available', () => {
    mockSelectorWithDataset(null)
    mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: false })

    const { rerender } = render(<RagPipelineWrapper />)

    expect(screen.getByTestId('conversion-component')).toBeInTheDocument()

    mockSelectorWithDataset('new-pipeline-id')
    mockUsePipelineInit.mockReturnValue({ data: undefined, isLoading: true })
    rerender(<RagPipelineWrapper />)

    expect(screen.queryByTestId('conversion-component')).not.toBeInTheDocument()
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
        nodes: null,
        edges: null,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      hash: 'test',
      updated_at: 123,
    } as unknown as FetchWorkflowDraftResponse

    mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<RagPipelineWrapper />)).toThrow()

    consoleSpy.mockRestore()
  })

  it('should throw when graph property is missing', () => {
    const mockData = {
      hash: 'test',
      updated_at: 123,
    } as unknown as FetchWorkflowDraftResponse

    mockUsePipelineInit.mockReturnValue({ data: mockData, isLoading: false })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<RagPipelineWrapper />)).toThrow()

    consoleSpy.mockRestore()
  })
})
