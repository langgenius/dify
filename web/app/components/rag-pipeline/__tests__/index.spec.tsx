import { render, screen } from '@testing-library/react'
import RagPipelineWrapper from '../index'

let pipelineId: string | undefined
let pipelineInit: { data?: Record<string, unknown>; isLoading: boolean }

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ dataset: pipelineId ? { pipeline_id: pipelineId } : undefined }),
}))

vi.mock('../hooks', () => ({
  usePipelineInit: () => pipelineInit,
}))

vi.mock('../store', () => ({
  createRagPipelineSliceSlice: vi.fn(),
}))

vi.mock('@/app/components/workflow/utils', () => ({
  initialNodes: () => [{ id: 'node-1' }],
  initialEdges: () => [{ id: 'edge-1' }],
}))

vi.mock('../utils', () => ({
  processNodesWithoutDataSource: (nodes: unknown[]) => ({
    nodes,
    viewport: { x: 10, y: 20, zoom: 2 },
  }),
}))

vi.mock('../components/conversion', () => ({
  default: () => <div>Conversion</div>,
}))

vi.mock('../components/rag-pipeline-main', () => ({
  default: ({
    nodes,
    edges,
    viewport,
  }: {
    nodes: unknown[]
    edges: unknown[]
    viewport: { zoom: number }
  }) => (
    <div>
      Pipeline {nodes.length}/{edges.length}/{viewport.zoom}
    </div>
  ),
}))

vi.mock('@/app/components/workflow', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe('RagPipeline', () => {
  beforeEach(() => {
    pipelineId = undefined
    pipelineInit = { data: undefined, isLoading: false }
  })

  it('offers conversion when the dataset has no pipeline', () => {
    render(<RagPipelineWrapper />)

    expect(screen.getByText('Conversion')).toBeInTheDocument()
  })

  it('shows loading while an existing pipeline initializes', () => {
    pipelineId = 'pipeline-1'
    pipelineInit = { data: undefined, isLoading: true }

    render(<RagPipelineWrapper />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('passes initialized graph data to the pipeline', () => {
    pipelineId = 'pipeline-1'
    pipelineInit = {
      data: { graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } },
      isLoading: false,
    }

    render(<RagPipelineWrapper />)

    expect(screen.getByText('Pipeline 1/1/2')).toBeInTheDocument()
  })
})
