import type { KnowledgeRetrievalNodeType } from '../types'
import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import { DatasetsDetailContext } from '../../../datasets-detail-store/provider'
import { createDatasetsDetailStore } from '../../../datasets-detail-store/store'
import { BlockEnum } from '../../../types'
import Node from '../node'
import { MetadataFilteringModeEnum } from '../types'

const createDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
  id: 'dataset-1',
  name: 'Dataset Name',
  indexing_status: 'completed',
  icon_info: {
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_type: 'emoji',
    icon_url: '',
  },
  description: 'Dataset description',
  permission: DatasetPermission.onlyMe,
  data_source_type: DataSourceType.FILE,
  indexing_technique: 'high_quality' as DataSet['indexing_technique'],
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 1690000000,
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 1,
  total_document_count: 1,
  word_count: 1000,
  provider: 'internal',
  embedding_model: 'text-embedding-3',
  embedding_model_provider: 'openai',
  embedding_available: true,
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 5,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  retrieval_model: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 5,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  tags: [],
  external_knowledge_info: {
    external_knowledge_id: '',
    external_knowledge_api_id: '',
    external_knowledge_api_name: '',
    external_knowledge_api_endpoint: '',
  },
  external_retrieval_model: {
    top_k: 0,
    score_threshold: 0,
    score_threshold_enabled: false,
  },
  built_in_field_enabled: false,
  runtime_mode: 'rag_pipeline',
  enable_api: false,
  is_multimodal: false,
  ...overrides,
})

const createData = (overrides: Partial<KnowledgeRetrievalNodeType> = {}): KnowledgeRetrievalNodeType => ({
  title: 'Knowledge Retrieval',
  desc: '',
  type: BlockEnum.KnowledgeRetrieval,
  query_variable_selector: ['start', 'sys.query'],
  query_attachment_selector: [],
  dataset_ids: ['dataset-1'],
  retrieval_mode: RETRIEVE_TYPE.multiWay,
  metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
  ...overrides,
})

const renderWithDatasets = (data: KnowledgeRetrievalNodeType, datasets: DataSet[] = []) => {
  const store = createDatasetsDetailStore()
  store.getState().updateDatasetsDetail(datasets)

  return render(
    <DatasetsDetailContext.Provider value={store}>
      <Node id="knowledge-node" data={data} />
    </DatasetsDetailContext.Provider>,
  )
}

describe('knowledge-retrieval/node', () => {
  it('renders matched dataset details and falls back to the default icon info when a dataset has no icon', async () => {
    renderWithDatasets(
      createData({
        dataset_ids: ['dataset-1', 'dataset-2'],
      }),
      [
        createDataset(),
        createDataset({
          id: 'dataset-2',
          name: 'Fallback Icon Dataset',
          icon_info: undefined as never,
        }),
      ],
    )

    expect(await screen.findByText('Dataset Name')).toBeInTheDocument()
    expect(screen.getByText('Fallback Icon Dataset')).toBeInTheDocument()
  })

  it('renders nothing when the node has no dataset ids or no matching dataset details', () => {
    const { container, rerender } = renderWithDatasets(
      createData({
        dataset_ids: ['missing-dataset'],
      }),
      [createDataset()],
    )

    expect(container).toBeEmptyDOMElement()

    const store = createDatasetsDetailStore()
    store.getState().updateDatasetsDetail([createDataset()])

    rerender(
      <DatasetsDetailContext.Provider value={store}>
        <Node
          id="knowledge-node"
          data={createData({
            dataset_ids: [],
          })}
        />
      </DatasetsDetailContext.Provider>,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
