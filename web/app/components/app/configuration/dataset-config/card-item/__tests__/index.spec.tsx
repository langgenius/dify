import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type * as React from 'react'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { RetrievalConfig } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import Item from '../index'

vi.mock('../../settings-modal', () => ({
  default: ({
    onSave,
    onCancel,
    currentDataset,
  }: {
    currentDataset: DatasetDetailWithPartialMembersResponse
    onCancel: () => void
    onSave: (newDataset: DatasetDetailWithPartialMembersResponse) => void
  }) => (
    <div>
      <div>Mock settings modal</div>
      <button
        onClick={() =>
          onSave({
            ...currentDataset,
            retrieval_model_dict: { ...currentDataset.retrieval_model_dict, top_k: 6 },
          })
        }
      >
        Save changes
      </button>
      <button onClick={onCancel}>Close</button>
    </div>
  ),
}))

const baseRetrievalConfig: RetrievalConfig = {
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: {
    reranking_provider_name: 'provider',
    reranking_model_name: 'rerank-model',
  },
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0,
}

const defaultIndexingTechnique: IndexingType = 'high_quality' as IndexingType

const createDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
): DatasetDetailWithPartialMembersResponse => {
  const { retrieval_model_dict, icon_info, ...restOverrides } = overrides

  const resolvedRetrievalModelDict = {
    ...baseRetrievalConfig,
    ...retrieval_model_dict,
  }

  const defaultIconInfo = {
    icon: '📘',
    icon_type: 'emoji',
    icon_background: '#FFEAD5',
    icon_url: '',
  }

  const resolvedIconInfo = 'icon_info' in overrides ? icon_info : defaultIconInfo

  return {
    ...createDatasetFixture(),
    id: 'dataset-id',
    name: 'Dataset Name',
    icon_info: resolvedIconInfo,
    description: 'A test dataset',
    permission: PermissionLevel.onlyMe,
    data_source_type: DataSourceType.FILE,
    indexing_technique: defaultIndexingTechnique,
    author_name: 'author',
    created_by: 'creator',
    updated_by: 'updater',
    updated_at: 0,
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 0,
    total_available_documents: 0,
    word_count: 0,
    provider: 'dify',
    embedding_model: 'text-embedding',
    embedding_model_provider: 'openai',
    embedding_available: true,
    retrieval_model_dict: resolvedRetrievalModelDict,
    tags: [],
    external_knowledge_info: {
      external_knowledge_id: 'external-id',
      external_knowledge_api_id: 'api-id',
      external_knowledge_api_name: 'api-name',
      external_knowledge_api_endpoint: 'https://endpoint',
    },
    external_retrieval_model: {
      top_k: 2,
      score_threshold: 0.5,
      score_threshold_enabled: true,
    },
    built_in_field_enabled: true,
    doc_metadata: [],
    keyword_number: 3,
    pipeline_id: 'pipeline-id',
    is_published: true,
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
    ...restOverrides,
  }
}

const renderItem = (
  config: DatasetDetailWithPartialMembersResponse,
  props?: Partial<React.ComponentProps<typeof Item>>,
) => {
  const onSave = vi.fn()
  const onRemove = vi.fn()

  render(<Item config={config} onSave={onSave} onRemove={onRemove} {...props} />)

  return { onSave, onRemove }
}

describe('dataset-config/card-item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render dataset details with indexing and external badges', () => {
    const dataset = createDataset({
      provider: 'external',
      retrieval_model_dict: {
        ...baseRetrievalConfig,
        search_method: RETRIEVE_METHOD.semantic,
      },
    })

    renderItem(dataset)

    const editButton = screen.getByRole('button', {
      name: 'common.operation.edit',
      hidden: true,
    })
    const removeButton = screen.getByRole('button', {
      name: 'common.operation.remove',
      hidden: true,
    })

    expect(screen.getByText(dataset.name))!.toBeInTheDocument()
    expect(
      screen.getByText(
        'dataset.indexingTechnique.high_quality · dataset.indexingMethod.semantic_search',
      ),
    )!.toBeInTheDocument()
    expect(screen.getByText('dataset.externalTag'))!.toBeInTheDocument()
    expect(editButton).toBeInTheDocument()
    expect(removeButton).toBeInTheDocument()
  })

  it('should open settings drawer from edit action and close after saving', async () => {
    const user = userEvent.setup()
    const dataset = createDataset()
    const { onSave } = renderItem(dataset)

    const editButton = screen.getByRole('button', {
      name: 'common.operation.edit',
      hidden: true,
    })
    await user.click(editButton)

    expect(await screen.findByText('Mock settings modal'))!.toBeInTheDocument()
    await user.click(await screen.findByText('Save changes'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: dataset.id,
          retrieval_model_dict: expect.objectContaining({ top_k: 6 }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByText('Mock settings modal')).not.toBeInTheDocument()
    })
  })

  it('should call onRemove from its named icon command', async () => {
    const user = userEvent.setup()
    const dataset = createDataset()
    const { onRemove } = renderItem(dataset)

    const deleteButton = screen.getByRole('button', {
      name: 'common.operation.remove',
      hidden: true,
    })

    await user.click(deleteButton)
    expect(onRemove).toHaveBeenCalledWith(dataset.id)
  })
})
