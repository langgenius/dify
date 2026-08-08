import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import DatasetCardHeader from '../dataset-card-header'

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ icon }: { icon?: string }) => <span>{icon}</span>,
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'High Quality',
  }),
}))

vi.mock('react-i18next', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: { ns?: string }) =>
        options?.ns ? `${options.ns}.${key}` : key,
      ),
    }),
  }
})

const createDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
  id: 'dataset-1',
  name: 'Test Dataset',
  description: 'Test description',
  indexing_status: 'completed',
  provider: 'vendor',
  permission: DatasetPermission.allTeamMembers,
  data_source_type: DataSourceType.FILE,
  indexing_technique: IndexingType.QUALIFIED,
  embedding_available: true,
  app_count: 5,
  document_count: 10,
  total_document_count: 10,
  word_count: 1000,
  updated_at: 1609545600,
  updated_by: 'user-1',
  tags: [],
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  created_by: 'user-1',
  doc_form: ChunkingMode.text,
  runtime_mode: 'general',
  is_published: true,
  enable_api: true,
  is_multimodal: false,
  built_in_field_enabled: false,
  icon_info: {
    icon: '📙',
    icon_type: 'emoji' as const,
    icon_background: '#FFF4ED',
    icon_url: '',
  },
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
  } as DataSet['retrieval_model_dict'],
  retrieval_model: {
    search_method: RETRIEVE_METHOD.semantic,
  } as DataSet['retrieval_model'],
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
  author_name: 'Test User',
  ...overrides,
})

describe('DatasetCardHeader', () => {
  it('shows the dataset name and indexing mode', () => {
    render(<DatasetCardHeader dataset={createDataset({ name: 'Product docs' })} />)

    expect(screen.getByText('Product docs')).toBeInTheDocument()
    expect(screen.getByText('dataset.chunkingMode.general')).toBeInTheDocument()
    expect(screen.getByText('High Quality')).toBeInTheDocument()
  })

  it('identifies an external knowledge base', () => {
    render(<DatasetCardHeader dataset={createDataset({ provider: 'external' })} />)

    expect(screen.getByText('dataset.externalKnowledgeBase')).toBeInTheDocument()
  })

  it('identifies a multimodal dataset', () => {
    render(<DatasetCardHeader dataset={createDataset({ is_multimodal: true })} />)

    expect(screen.getByText('dataset.multimodal')).toBeInTheDocument()
  })

  it('hides indexing details for an unpublished pipeline', () => {
    render(
      <DatasetCardHeader
        dataset={createDataset({
          runtime_mode: 'rag_pipeline',
          is_published: false,
        })}
      />,
    )

    expect(screen.getByText('dataset.cornerLabel.pipeline')).toBeInTheDocument()
    expect(screen.queryByText('High Quality')).not.toBeInTheDocument()
  })
})
