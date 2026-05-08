import type { ReactNode } from 'react'
import type { KnowledgeRetrievalNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import type { DataSet, MetadataInDoc } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import Panel from '../panel'
import { ComparisonOperator, LogicalOperator, MetadataFilteringModeEnum, MetadataFilteringVariableType } from '../types'
import useConfig from '../use-config'

const mockVarReferencePicker = vi.hoisted(() => vi.fn())
const mockRetrievalConfig = vi.hoisted(() => vi.fn())
const mockDatasetList = vi.hoisted(() => vi.fn())
const mockAddKnowledge = vi.hoisted(() => vi.fn())
const mockMetadataFilter = vi.hoisted(() => vi.fn())

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

const createMetadata = (overrides: Partial<MetadataInDoc> = {}): MetadataInDoc => ({
  id: 'meta-1',
  name: 'topic',
  type: MetadataFilteringVariableType.string,
  value: 'topic',
  ...overrides,
})

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: (props: {
    value: string[]
    onChange: (value: string[]) => void
    filterVar: (value: { type: VarType }) => boolean
  }) => {
    mockVarReferencePicker(props)
    return (
      <button type="button" onClick={() => props.onChange(['node-2', 'query'])}>
        var-reference-picker
      </button>
    )
  },
}))

vi.mock('../components/retrieval-config', () => ({
  __esModule: true,
  default: (props: {
    onRetrievalModeChange: (value: RETRIEVE_TYPE) => void
    onMultipleRetrievalConfigChange: (value: KnowledgeRetrievalNodeType['multiple_retrieval_config']) => void
    onSingleRetrievalModelChange: (model: { provider: string, modelId: string, mode?: string }) => void
    onSingleRetrievalModelParamsChange: (params: Record<string, unknown>) => void
  }) => {
    mockRetrievalConfig(props)
    return (
      <div>
        <button type="button" onClick={() => props.onRetrievalModeChange(RETRIEVE_TYPE.oneWay)}>change-retrieval-mode</button>
        <button type="button" onClick={() => props.onMultipleRetrievalConfigChange({ top_k: 8, score_threshold: 0.4 })}>change-multiple-config</button>
        <button type="button" onClick={() => props.onSingleRetrievalModelChange({ provider: 'openai', modelId: 'gpt-4o-mini', mode: 'chat' })}>change-model</button>
        <button type="button" onClick={() => props.onSingleRetrievalModelParamsChange({ temperature: 0.2 })}>change-model-params</button>
      </div>
    )
  },
}))

vi.mock('../components/dataset-list', () => ({
  __esModule: true,
  default: (props: { list: DataSet[], onChange: (datasets: DataSet[]) => void }) => {
    mockDatasetList(props)
    return (
      <button
        type="button"
        onClick={() => props.onChange([createDataset({ id: 'dataset-2', name: 'Updated Dataset' })])}
      >
        dataset-list
      </button>
    )
  },
}))

vi.mock('../components/add-dataset', () => ({
  __esModule: true,
  default: (props: { selectedIds: string[], onChange: (datasets: DataSet[]) => void }) => {
    mockAddKnowledge(props)
    return (
      <button
        type="button"
        onClick={() => props.onChange([createDataset({ id: 'dataset-3', name: 'Added Dataset' })])}
      >
        add-dataset
      </button>
    )
  },
}))

vi.mock('../components/metadata/metadata-filter', () => ({
  __esModule: true,
  default: (props: {
    metadataList: MetadataInDoc[]
    handleAddCondition: ({ id, name, type }: MetadataInDoc) => void
    handleMetadataFilterModeChange: (mode: MetadataFilteringModeEnum) => void
    handleRemoveCondition: (id: string) => void
    handleToggleConditionLogicalOperator: () => void
    handleUpdateCondition: (id: string, condition: unknown) => void
    handleMetadataModelChange: (model: { provider: string, modelId: string, mode?: string }) => void
    handleMetadataCompletionParamsChange: (params: Record<string, unknown>) => void
  }) => {
    mockMetadataFilter(props)
    return (
      <div>
        <div>{props.metadataList.map(item => item.name).join(',')}</div>
        <button type="button" onClick={() => props.handleAddCondition(createMetadata())}>add-condition</button>
        <button type="button" onClick={() => props.handleMetadataFilterModeChange(MetadataFilteringModeEnum.manual)}>change-filter-mode</button>
        <button type="button" onClick={() => props.handleRemoveCondition('condition-1')}>remove-condition</button>
        <button type="button" onClick={() => props.handleToggleConditionLogicalOperator()}>toggle-logical-operator</button>
        <button
          type="button"
          onClick={() => props.handleUpdateCondition('condition-1', {
            id: 'condition-1',
            name: 'topic',
            metadata_id: 'meta-1',
            comparison_operator: ComparisonOperator.is,
            value: 'agent',
          })}
        >
          update-condition
        </button>
        <button type="button" onClick={() => props.handleMetadataModelChange({ provider: 'openai', modelId: 'gpt-4.1-mini', mode: 'chat' })}>change-metadata-model</button>
        <button type="button" onClick={() => props.handleMetadataCompletionParamsChange({ temperature: 0.3 })}>change-metadata-params</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type }: { name: string, type: string }) => <div>{`${name}:${type}`}</div>,
}))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createData = (overrides: Partial<KnowledgeRetrievalNodeType> = {}): KnowledgeRetrievalNodeType => ({
  title: 'Knowledge Retrieval',
  desc: '',
  type: BlockEnum.KnowledgeRetrieval,
  query_variable_selector: ['start', 'sys.query'],
  query_attachment_selector: [],
  dataset_ids: ['dataset-1'],
  retrieval_mode: RETRIEVE_TYPE.multiWay,
  multiple_retrieval_config: { top_k: 5, score_threshold: 0.5 },
  single_retrieval_config: {
    model: {
      provider: 'openai',
      name: 'gpt-4o-mini',
      mode: 'chat',
      completion_params: {},
    },
  },
  metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
  metadata_filtering_conditions: {
    logical_operator: LogicalOperator.and,
    conditions: [{
      id: 'condition-1',
      name: 'topic',
      metadata_id: 'meta-1',
      comparison_operator: ComparisonOperator.contains,
      value: 'agent',
    }],
  },
  metadata_model_config: {
    provider: 'openai',
    name: 'gpt-4.1-mini',
    mode: 'chat',
    completion_params: {},
  },
  ...overrides,
})

const panelProps = {} as NodePanelProps<KnowledgeRetrievalNodeType>['panelProps']

describe('knowledge-retrieval/panel', () => {
  const handleQueryVarChange = vi.fn()
  const handleQueryAttachmentChange = vi.fn()
  const handleModelChanged = vi.fn()
  const handleCompletionParamsChange = vi.fn()
  const handleRetrievalModeChange = vi.fn()
  const handleMultipleRetrievalConfigChange = vi.fn()
  const handleOnDatasetsChange = vi.fn()
  const setRerankModelOpen = vi.fn()
  const handleAddCondition = vi.fn()
  const handleMetadataFilterModeChange = vi.fn()
  const handleRemoveCondition = vi.fn()
  const handleToggleConditionLogicalOperator = vi.fn()
  const handleUpdateCondition = vi.fn()
  const handleMetadataModelChange = vi.fn()
  const handleMetadataCompletionParamsChange = vi.fn()

  const createConfigResult = (overrides: Record<string, unknown> = {}) => ({
    readOnly: false,
    inputs: createData(),
    handleQueryVarChange,
    handleQueryAttachmentChange,
    filterStringVar: vi.fn((value: { type: VarType }) => value.type === VarType.string),
    filterFileVar: vi.fn((value: { type: VarType }) => value.type === VarType.file),
    handleModelChanged,
    handleCompletionParamsChange,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
    selectedDatasets: [
      createDataset({ doc_metadata: [createMetadata(), createMetadata({ id: 'meta-2', name: 'shared' })] }),
      createDataset({ id: 'dataset-2', doc_metadata: [createMetadata({ id: 'meta-3', name: 'shared' }), createMetadata({ id: 'meta-4', name: 'language' })] }),
    ],
    selectedDatasetsLoaded: true,
    handleOnDatasetsChange,
    rerankModelOpen: false,
    setRerankModelOpen,
    handleAddCondition,
    handleMetadataFilterModeChange,
    handleRemoveCondition,
    handleToggleConditionLogicalOperator,
    handleUpdateCondition,
    handleMetadataModelChange,
    handleMetadataCompletionParamsChange,
    availableStringVars: [],
    availableStringNodesWithParent: [],
    availableNumberVars: [],
    availableNumberNodesWithParent: [],
    showImageQueryVarSelector: true,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult() as ReturnType<typeof useConfig>)
  })

  it('wires panel actions and passes the intersected metadata list to metadata filters', async () => {
    const user = userEvent.setup()

    render(
      <Panel
        id="knowledge-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('result:Array[Object]')).toBeInTheDocument()
    expect(screen.getByText('shared')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'var-reference-picker' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'var-reference-picker' })[1]!)
    await user.click(screen.getByRole('button', { name: 'change-retrieval-mode' }))
    await user.click(screen.getByRole('button', { name: 'change-multiple-config' }))
    await user.click(screen.getByRole('button', { name: 'change-model' }))
    await user.click(screen.getByRole('button', { name: 'change-model-params' }))
    await user.click(screen.getByRole('button', { name: 'dataset-list' }))
    await user.click(screen.getByRole('button', { name: 'add-dataset' }))
    await user.click(screen.getByRole('button', { name: 'add-condition' }))
    await user.click(screen.getByRole('button', { name: 'change-filter-mode' }))
    await user.click(screen.getByRole('button', { name: 'remove-condition' }))
    await user.click(screen.getByRole('button', { name: 'toggle-logical-operator' }))
    await user.click(screen.getByRole('button', { name: 'update-condition' }))
    await user.click(screen.getByRole('button', { name: 'change-metadata-model' }))
    await user.click(screen.getByRole('button', { name: 'change-metadata-params' }))

    expect(handleQueryVarChange).toHaveBeenCalledWith(['node-2', 'query'])
    expect(handleQueryAttachmentChange).toHaveBeenCalledWith(['node-2', 'query'])
    expect(handleRetrievalModeChange).toHaveBeenCalledWith(RETRIEVE_TYPE.oneWay)
    expect(handleMultipleRetrievalConfigChange).toHaveBeenCalledWith({ top_k: 8, score_threshold: 0.4 })
    expect(handleModelChanged).toHaveBeenCalledWith({ provider: 'openai', modelId: 'gpt-4o-mini', mode: 'chat' })
    expect(handleCompletionParamsChange).toHaveBeenCalledWith({ temperature: 0.2 })
    expect(handleOnDatasetsChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'dataset-2' })])
    expect(handleOnDatasetsChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'dataset-3' })])
    expect(handleAddCondition).toHaveBeenCalledWith(expect.objectContaining({ id: 'meta-1' }))
    expect(handleMetadataFilterModeChange).toHaveBeenCalledWith(MetadataFilteringModeEnum.manual)
    expect(handleRemoveCondition).toHaveBeenCalledWith('condition-1')
    expect(handleToggleConditionLogicalOperator).toHaveBeenCalledTimes(1)
    expect(handleUpdateCondition).toHaveBeenCalledWith('condition-1', expect.objectContaining({ comparison_operator: ComparisonOperator.is }))
    expect(handleMetadataModelChange).toHaveBeenCalledWith({ provider: 'openai', modelId: 'gpt-4.1-mini', mode: 'chat' })
    expect(handleMetadataCompletionParamsChange).toHaveBeenCalledWith({ temperature: 0.3 })
    expect(mockMetadataFilter).toHaveBeenCalledWith(expect.objectContaining({
      metadataList: [expect.objectContaining({ name: 'shared' })],
    }))
  })

  it('hides readonly-only controls and the attachment selector when image queries are unavailable', () => {
    mockUseConfig.mockReturnValueOnce(createConfigResult({
      readOnly: true,
      showImageQueryVarSelector: false,
    }) as ReturnType<typeof useConfig>)

    render(
      <Panel
        id="knowledge-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'var-reference-picker' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'add-dataset' })).not.toBeInTheDocument()
  })
})
