import type { IndexingStatusResponse } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmbeddingProcess from '../index'

const mockPush = vi.fn()
const mockInvalidDocumentList = vi.fn()
let mockEnableBilling = false
let mockPlanType = 'sandbox'
let mockPollingState: {
  statusList: IndexingStatusResponse[]
  isEmbedding: boolean
  isEmbeddingCompleted: boolean
} = {
  statusList: [],
  isEmbedding: false,
  isEmbeddingCompleted: false,
}

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode
    href: string
    target?: string
    rel?: string
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useProcessRule: () => ({ data: undefined }),
}))

vi.mock('@/service/knowledge/use-document', () => ({
  useInvalidDocumentList: () => mockInvalidDocumentList,
}))

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://api.example.com/docs',
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableBilling: mockEnableBilling,
    plan: { type: mockPlanType },
  }),
}))

vi.mock('../use-indexing-status-polling', () => ({
  useIndexingStatusPolling: () => mockPollingState,
}))

vi.mock('../indexing-progress-item', () => ({
  default: () => <div>progress item</div>,
}))

vi.mock('../rule-detail', () => ({
  default: () => <div>rule detail</div>,
}))

vi.mock('../upgrade-banner', () => ({
  default: () => <div>upgrade processing priority</div>,
}))

describe('EmbeddingProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnableBilling = false
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

    expect(screen.getByText('datasetDocuments.embedding.processing')).toBeInTheDocument()
  })

  it('shows that document indexing has completed', () => {
    mockPollingState.isEmbeddingCompleted = true

    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    expect(screen.getByText('datasetDocuments.embedding.completed')).toBeInTheDocument()
  })

  it('invalidates the document list before navigating to it', async () => {
    const user = userEvent.setup()
    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    await user.click(screen.getByRole('button', { name: 'datasetCreation.stepThree.navTo' }))

    expect(mockInvalidDocumentList).toHaveBeenCalledOnce()
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents')
  })

  it('links to the dataset API reference', () => {
    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    expect(screen.getByRole('link', { name: 'Access the API' })).toHaveAttribute(
      'href',
      'https://api.example.com/docs',
    )
  })

  it('offers a processing-priority upgrade outside the team plan', () => {
    mockEnableBilling = true

    render(<EmbeddingProcess datasetId="dataset-1" batchId="batch-1" />)

    expect(screen.getByText('upgrade processing priority')).toBeInTheDocument()
  })
})
