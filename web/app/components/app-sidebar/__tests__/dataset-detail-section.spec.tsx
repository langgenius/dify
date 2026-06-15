import type { DataSet, RelatedAppResponse } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import DatasetDetailSection from '../dataset-detail-section'

let mockPathname = '/datasets/dataset-1/documents'
let mockIsDatasetOperator = false
let mockDataset: DataSet | undefined
let mockRelatedApps: RelatedAppResponse | undefined

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceDatasetOperator: mockIsDatasetOperator,
  }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetDetail: () => ({ data: mockDataset, refetch: vi.fn() }),
  useDatasetRelatedApps: () => ({ data: mockRelatedApps }),
}))

vi.mock('../dataset-info', () => ({
  default: ({ expand }: { expand: boolean }) => <div data-testid="dataset-info" data-expand={expand} />,
}))

vi.mock('../nav-link', () => ({
  default: ({ name, href }: { name: string, href: string }) => <a href={href}>{name}</a>,
}))

vi.mock('../../datasets/extra-info', () => ({
  default: ({ expand, documentCount }: { expand: boolean, documentCount?: number }) => (
    <div data-testid="extra-info" data-expand={expand} data-document-count={documentCount} />
  ),
}))

const createDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
  id: 'dataset-1',
  name: 'Camera Technical Spec',
  description: '',
  provider: 'internal',
  icon_info: {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#F0F9FF',
    icon_url: '',
  },
  doc_form: 'hierarchical_model',
  indexing_technique: 'high_quality',
  document_count: 120,
  runtime_mode: 'general',
  retrieval_model_dict: {
    search_method: 'semantic_search',
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 5,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  enable_api: true,
  ...overrides,
} as DataSet)

describe('DatasetDetailSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/datasets/dataset-1/documents'
    mockIsDatasetOperator = false
    mockDataset = createDataset()
    mockRelatedApps = {
      data: [],
      total: 5,
    }
  })

  it('should pin dataset stats and API access to the bottom of the expanded sidebar', () => {
    render(<DatasetDetailSection expand />)

    const extraInfo = screen.getByTestId('extra-info')

    expect(extraInfo).toHaveAttribute('data-expand', 'true')
    expect(extraInfo).toHaveAttribute('data-document-count', '120')
    expect(extraInfo.parentElement).toHaveClass('mt-auto', 'shrink-0')
  })
})
