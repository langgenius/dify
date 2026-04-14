import type { DataSet } from '@/models/datasets'
import { renderHook } from '@testing-library/react'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { DatasetsDetailContext } from '../provider'
import { createDatasetsDetailStore, useDatasetsDetailStore } from '../store'

const createDataset = (id: string, name = `dataset-${id}`): DataSet => ({
  id,
  name,
  indexing_status: 'completed',
  icon_info: {
    icon: 'book',
    icon_type: 'emoji' as DataSet['icon_info']['icon_type'],
  },
  description: `${name} description`,
  permission: DatasetPermission.onlyMe,
  data_source_type: DataSourceType.FILE,
  indexing_technique: 'high_quality' as DataSet['indexing_technique'],
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 1,
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 0,
  total_document_count: 0,
  word_count: 0,
  provider: 'provider',
  embedding_model: 'model',
  embedding_model_provider: 'provider',
  embedding_available: true,
  retrieval_model_dict: {} as DataSet['retrieval_model_dict'],
  retrieval_model: {} as DataSet['retrieval_model'],
  tags: [],
  external_knowledge_info: {
    external_knowledge_id: '',
    external_knowledge_api_id: '',
    external_knowledge_api_name: '',
    external_knowledge_api_endpoint: '',
  },
  external_retrieval_model: {
    top_k: 1,
    score_threshold: 0,
    score_threshold_enabled: false,
  },
  built_in_field_enabled: false,
  runtime_mode: 'general',
  enable_api: false,
  is_multimodal: false,
})

describe('datasets-detail-store store', () => {
  it('merges dataset details by id', () => {
    const store = createDatasetsDetailStore()

    store.getState().updateDatasetsDetail([
      createDataset('dataset-1', 'Dataset One'),
      createDataset('dataset-2', 'Dataset Two'),
    ])
    store.getState().updateDatasetsDetail([
      createDataset('dataset-2', 'Dataset Two Updated'),
    ])

    expect(store.getState().datasetsDetail).toMatchObject({
      'dataset-1': { name: 'Dataset One' },
      'dataset-2': { name: 'Dataset Two Updated' },
    })
  })

  it('reads state from the datasets detail context', () => {
    const store = createDatasetsDetailStore()
    store.getState().updateDatasetsDetail([createDataset('dataset-3')])
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatasetsDetailContext.Provider value={store}>
        {children}
      </DatasetsDetailContext.Provider>
    )

    const { result } = renderHook(
      () => useDatasetsDetailStore(state => state.datasetsDetail['dataset-3']?.name),
      { wrapper },
    )

    expect(result.current).toBe('dataset-dataset-3')
  })

  it('throws when the datasets detail provider is missing', () => {
    expect(() => renderHook(() => useDatasetsDetailStore(state => state.datasetsDetail))).toThrow(
      'Missing DatasetsDetailContext.Provider in the tree',
    )
  })
})
