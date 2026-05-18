import { render, screen } from '@testing-library/react'
import ProcessDocuments from '../process-documents'

const mockUseDraftPipelineProcessingParams = vi.hoisted(() => vi.fn(() => ({
  data: {
    variables: [{ variable: 'chunkSize' }],
  },
})))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { pipelineId: string }) => string) => selector({ pipelineId: 'pipeline-1' }),
}))

vi.mock('@/service/use-pipeline', () => ({
  useDraftPipelineProcessingParams: mockUseDraftPipelineProcessingParams,
}))

vi.mock('../form', () => ({
  default: ({ variables }: { variables: Array<{ variable: string }> }) => (
    <div data-testid="preview-form">{variables.map(item => item.variable).join(',')}</div>
  ),
}))

describe('ProcessDocuments preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the processing step and its variables', () => {
    render(<ProcessDocuments dataSourceNodeId="node-2" />)

    expect(screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle')).toBeInTheDocument()
    expect(screen.getByTestId('preview-form')).toHaveTextContent('chunkSize')
    expect(mockUseDraftPipelineProcessingParams).toHaveBeenCalledWith({
      pipeline_id: 'pipeline-1',
      node_id: 'node-2',
    }, true)
  })
})
