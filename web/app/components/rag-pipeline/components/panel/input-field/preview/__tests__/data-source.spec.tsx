import type { Datasource } from '../../../test-run/types'
import { fireEvent, render, screen } from '@testing-library/react'
import DataSource from '../data-source'

const {
  mockOnSelect,
  mockUseDraftPipelinePreProcessingParams,
} = vi.hoisted(() => ({
  mockOnSelect: vi.fn(),
  mockUseDraftPipelinePreProcessingParams: vi.fn(() => ({
    data: {
      variables: [{ variable: 'source' }],
    },
  })),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { pipelineId: string }) => string) => selector({ pipelineId: 'pipeline-1' }),
}))

vi.mock('@/service/use-pipeline', () => ({
  useDraftPipelinePreProcessingParams: mockUseDraftPipelinePreProcessingParams,
}))

vi.mock('../../../test-run/preparation/data-source-options', () => ({
  default: ({
    onSelect,
    dataSourceNodeId,
  }: {
    onSelect: (data: Datasource) => void
    dataSourceNodeId: string
  }) => (
    <div data-testid="data-source-options" data-node-id={dataSourceNodeId}>
      <button
        onClick={() => onSelect({ nodeId: 'source-node' } as Datasource)}
      >
        select datasource
      </button>
    </div>
  ),
}))

vi.mock('../form', () => ({
  default: ({ variables }: { variables: Array<{ variable: string }> }) => (
    <div data-testid="preview-form">{variables.map(item => item.variable).join(',')}</div>
  ),
}))

describe('DataSource preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the datasource selection step and forward selected values', () => {
    render(
      <DataSource
        onSelect={mockOnSelect}
        dataSourceNodeId="node-1"
      />,
    )

    fireEvent.click(screen.getByText('select datasource'))

    expect(screen.getByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle')).toBeInTheDocument()
    expect(screen.getByTestId('data-source-options')).toHaveAttribute('data-node-id', 'node-1')
    expect(screen.getByTestId('preview-form')).toHaveTextContent('source')
    expect(mockUseDraftPipelinePreProcessingParams).toHaveBeenCalledWith({
      pipeline_id: 'pipeline-1',
      node_id: 'node-1',
    }, true)
    expect(mockOnSelect).toHaveBeenCalledWith({ nodeId: 'source-node' })
  })
})
