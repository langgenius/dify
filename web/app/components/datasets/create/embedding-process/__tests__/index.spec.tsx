import type { DocumentStatusResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactElement } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import EmbeddingProcess from '../index'

const status: DocumentStatusResponse = {
  id: 'document-1',
  indexing_status: 'completed',
  completed_segments: 1,
  total_segments: 1,
  processing_started_at: null,
  parsing_completed_at: null,
  cleaning_completed_at: null,
  splitting_completed_at: null,
  completed_at: null,
  paused_at: null,
  error: null,
  stopped_at: null,
}

let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'COMMUNITY'
let mockPlanType: 'sandbox' | 'professional' | 'team' = 'sandbox'
let mockPollingState: {
  statusList: DocumentStatusResponse[]
  isEmbedding: boolean
  isEmbeddingCompleted: boolean
} = {
  statusList: [],
  isEmbedding: false,
  isEmbeddingCompleted: false,
}

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://api.example.com/docs',
}))

vi.mock('../use-indexing-status-polling', () => ({
  useIndexingStatusPolling: () => mockPollingState,
}))

vi.mock('../upgrade-banner', () => ({
  default: () => <div>upgrade processing priority</div>,
}))

function render(ui: ReactElement) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: deploymentEdition },
    features: { billing: { subscription: { plan: mockPlanType } } },
  })
}

describe('EmbeddingProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deploymentEdition = 'COMMUNITY'
    mockPlanType = 'sandbox'
    mockPollingState = {
      statusList: [],
      isEmbedding: false,
      isEmbeddingCompleted: false,
    }
  })

  it('shows that document indexing is in progress', () => {
    mockPollingState.isEmbedding = true

    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    expect(screen.getByRole('status')).toHaveTextContent('datasetDocuments.embedding.processing')
  })

  it('shows that document indexing has completed', () => {
    mockPollingState.isEmbeddingCompleted = true

    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    expect(screen.getByText('datasetDocuments.embedding.completed')).toHaveAttribute(
      'role',
      'status',
    )
  })

  it('shows the vector-space admission alert after processing completes', () => {
    mockPollingState = {
      statusList: [
        {
          ...status,
          id: 'document-1',
          indexing_status: 'error',
          error_code: 'vector_space_estimate_exceeded',
          estimated_vector_space_mb: 61,
          vector_space_limit_mb: 50,
        },
      ],
      isEmbedding: false,
      isEmbeddingCompleted: true,
    }

    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    expect(screen.getByText('datasetDocuments.embedding.completed')).toHaveAttribute(
      'role',
      'status',
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(
      'datasetDocuments.embedding.vectorSpaceEstimateExceeded.description',
    )
    expect(alert).toHaveTextContent('61')
    expect(alert).toHaveTextContent('50')
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not show the vector-space alert for another indexing error', () => {
    mockPollingState = {
      statusList: [
        {
          ...status,
          id: 'document-1',
          indexing_status: 'error',
          error_code: null,
          estimated_vector_space_mb: 61,
          vector_space_limit_mb: 50,
        },
      ],
      isEmbedding: false,
      isEmbeddingCompleted: true,
    }

    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not suggest an upgrade to team users', () => {
    deploymentEdition = 'CLOUD'
    mockPlanType = 'team'
    mockPollingState = {
      statusList: [
        {
          ...status,
          id: 'document-1',
          indexing_status: 'error',
          error_code: 'vector_space_estimate_exceeded',
          estimated_vector_space_mb: 61,
          vector_space_limit_mb: 50,
        },
      ],
      isEmbedding: false,
      isEmbeddingCompleted: true,
    }

    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(
      'datasetDocuments.embedding.vectorSpaceEstimateExceeded.description',
    )
    expect(alert).toHaveTextContent('61')
    expect(alert).toHaveTextContent('50')
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
  })

  it('links to the document list and invalidates its cache on activation', async () => {
    const user = userEvent.setup()
    const { queryClient } = render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)
    const documentListKey = consoleQuery.datasets.byDatasetId.documents.get.queryKey({
      input: { params: { dataset_id: 'dataset-1' } },
    })
    queryClient.setQueryData(documentListKey, {
      data: [],
      has_more: false,
      page: 1,
      limit: 20,
      total: 0,
    })

    const link = screen.getByRole('link', { name: 'datasetCreation.stepThree.navTo' })
    expect(link).toHaveAttribute('href', '/datasets/dataset-1/documents')
    await user.click(link)

    expect(queryClient.getQueryState(documentListKey)?.isInvalidated).toBe(true)
  })

  it('links to the dataset API reference', () => {
    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    expect(screen.getByRole('link', { name: 'Access the API' })).toHaveAttribute(
      'href',
      'https://api.example.com/docs',
    )
  })

  it('offers a processing-priority upgrade outside the team plan', () => {
    deploymentEdition = 'CLOUD'

    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    expect(screen.getByText('upgrade processing priority')).toBeInTheDocument()
  })
})
