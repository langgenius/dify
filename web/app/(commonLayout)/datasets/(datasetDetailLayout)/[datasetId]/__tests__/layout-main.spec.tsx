import type { ReactNode } from 'react'
import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import DatasetDetailLayout from '../layout-main'

let mockPathname = '/datasets/test-dataset-id/documents'
let mockDataset: DataSet | undefined
let mockCanAccessSnippetsAndEvaluation = true

const mockSetAppSidebarExpand = vi.fn()
const mockMutateDatasetRes = vi.fn()

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppSidebarExpand: typeof mockSetAppSidebarExpand }) => unknown) => selector({
    setAppSidebarExpand: mockSetAppSidebarExpand,
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
    desktop: 'desktop',
  },
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: vi.fn(),
    },
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceDatasetOperator: false,
  }),
}))

vi.mock('@/hooks/use-snippet-and-evaluation-plan-access', () => ({
  useSnippetAndEvaluationPlanAccess: () => ({
    canAccess: mockCanAccessSnippetsAndEvaluation,
    isReady: true,
  }),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetDetail: () => ({
    data: mockDataset,
    error: null,
    refetch: mockMutateDatasetRes,
  }),
  useDatasetRelatedApps: () => ({
    data: [],
  }),
}))

vi.mock('@/app/components/app-sidebar', () => ({
  default: ({
    navigation,
    children,
  }: {
    navigation: Array<{ name: string, href: string, disabled?: boolean }>
    children?: ReactNode
  }) => (
    <div data-testid="app-sidebar">
      {navigation.map(item => (
        <button
          key={item.href}
          type="button"
          disabled={item.disabled}
        >
          {item.name}
        </button>
      ))}
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/datasets/extra-info', () => ({
  default: () => <div data-testid="dataset-extra-info" />,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div role="status">loading</div>,
}))

const createDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
  id: 'test-dataset-id',
  name: 'Test Dataset',
  indexing_status: 'completed',
  icon_info: {
    icon: 'book',
    icon_background: '#fff',
    icon_type: 'emoji',
    icon_url: '',
  },
  description: '',
  permission: DatasetPermission.onlyMe,
  data_source_type: DataSourceType.FILE,
  indexing_technique: IndexingType.QUALIFIED,
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 0,
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 0,
  total_document_count: 0,
  word_count: 0,
  provider: 'vendor',
  embedding_model: 'text-embedding',
  embedding_model_provider: 'openai',
  embedding_available: true,
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  },
  retrieval_model: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  },
  tags: [],
  external_knowledge_info: {
    external_knowledge_id: '',
    external_knowledge_api_id: '',
    external_knowledge_api_name: '',
    external_knowledge_api_endpoint: '',
  },
  external_retrieval_model: {
    top_k: 3,
    score_threshold: 0.5,
    score_threshold_enabled: false,
  },
  built_in_field_enabled: false,
  pipeline_id: 'pipeline-1',
  is_published: true,
  runtime_mode: 'rag_pipeline',
  enable_api: false,
  is_multimodal: false,
  ...overrides,
})

describe('DatasetDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/datasets/test-dataset-id/documents'
    mockDataset = createDataset()
    mockCanAccessSnippetsAndEvaluation = true
  })

  describe('Evaluation navigation', () => {
    it('should hide the evaluation menu when the dataset is not a rag pipeline', () => {
      mockDataset = createDataset({
        runtime_mode: 'general',
        is_published: false,
      })

      render(
        <DatasetDetailLayout datasetId="test-dataset-id">
          <div data-testid="dataset-detail-content">content</div>
        </DatasetDetailLayout>,
      )

      expect(screen.queryByRole('button', { name: 'common.datasetMenus.evaluation' })).not.toBeInTheDocument()
    })

    it('should disable the evaluation menu when the rag pipeline is unpublished', () => {
      mockDataset = createDataset({
        is_published: false,
      })

      render(
        <DatasetDetailLayout datasetId="test-dataset-id">
          <div data-testid="dataset-detail-content">content</div>
        </DatasetDetailLayout>,
      )

      expect(screen.getByRole('button', { name: 'common.datasetMenus.evaluation' })).toBeDisabled()
    })

    it('should enable the evaluation menu when the rag pipeline is published', () => {
      render(
        <DatasetDetailLayout datasetId="test-dataset-id">
          <div data-testid="dataset-detail-content">content</div>
        </DatasetDetailLayout>,
      )

      expect(screen.getByRole('button', { name: 'common.datasetMenus.evaluation' })).toBeEnabled()
    })

    it('should hide the evaluation menu when snippet and evaluation access is unavailable', () => {
      mockCanAccessSnippetsAndEvaluation = false

      render(
        <DatasetDetailLayout datasetId="test-dataset-id">
          <div data-testid="dataset-detail-content">content</div>
        </DatasetDetailLayout>,
      )

      expect(screen.queryByRole('button', { name: 'common.datasetMenus.evaluation' })).not.toBeInTheDocument()
    })
  })
})
