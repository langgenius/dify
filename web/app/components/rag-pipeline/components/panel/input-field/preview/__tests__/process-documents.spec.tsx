import { screen } from '@testing-library/react'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import ProcessDocuments from '../process-documents'

const mockUseDraftPipelineProcessingParams = vi.hoisted(() =>
  vi.fn((_params?: unknown, _enabled?: boolean) => ({
    data: {
      variables: [{ variable: 'chunkSize' }],
    },
  })),
)

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { pipelineId: string }) => string) =>
    selector({ pipelineId: 'pipeline-1' }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get': (o: {
      input: { params: { pipeline_id: string }; query: { node_id: string } }
      enabled?: boolean
    }) =>
      mockUseDraftPipelineProcessingParams(
        { pipeline_id: o.input.params.pipeline_id, node_id: o.input.query.node_id },
        o.enabled,
      ),
  })
})

vi.mock('../form', () => ({
  default: ({ variables }: { variables: Array<{ variable: string }> }) => (
    <div data-testid="preview-form">{variables.map((item) => item.variable).join(',')}</div>
  ),
}))

describe('ProcessDocuments preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the processing step and its variables', () => {
    render(<ProcessDocuments dataSourceNodeId="node-2" />, {
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    })

    expect(
      screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('preview-form')).toHaveTextContent('chunkSize')
    expect(mockUseDraftPipelineProcessingParams).toHaveBeenCalledWith(
      {
        pipeline_id: 'pipeline-1',
        node_id: 'node-2',
      },
      true,
    )
  })
})
