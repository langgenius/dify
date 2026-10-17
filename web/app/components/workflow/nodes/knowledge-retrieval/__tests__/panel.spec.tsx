import type {
  DatasetDetailWithPartialMembersResponse,
  DatasetDocMetadataResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { KnowledgeRetrievalNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import Panel from '../panel'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '../types'
import useConfig from '../use-config'

const createDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
): DatasetDetailWithPartialMembersResponse => ({
  ...createDatasetFixture(),
  id: 'dataset-1',
  name: 'Dataset Name',
  icon_info: {
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_type: 'emoji',
    icon_url: '',
  },
  description: 'Dataset description',
  permission: PermissionLevel.onlyMe,
  data_source_type: DataSourceType.FILE,
  indexing_technique:
    'high_quality' as DatasetDetailWithPartialMembersResponse['indexing_technique'],
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 1690000000,
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 1,
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

const createMetadata = (
  overrides: Partial<DatasetDocMetadataResponse> = {},
): DatasetDocMetadataResponse => ({
  id: 'meta-1',
  name: 'topic',
  type: MetadataFilteringVariableType.string,
  ...overrides,
})

// Retrieval and metadata have their own interaction suites; this suite covers panel composition.
vi.mock('../components/retrieval-config', () => ({ default: () => null }))
vi.mock('../components/add-dataset', () => ({
  default: () => <button type="button">Add knowledge</button>,
}))
vi.mock('../components/metadata/metadata-filter', () => ({
  default: ({ metadataList }: { metadataList: DatasetDocMetadataResponse[] }) => (
    <ul aria-label="Shared metadata">
      {metadataList.map((metadata) => (
        <li key={metadata.id}>{metadata.name}</li>
      ))}
    </ul>
  ),
}))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createData = (
  overrides: Partial<KnowledgeRetrievalNodeType> = {},
): KnowledgeRetrievalNodeType => ({
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
    conditions: [
      {
        id: 'condition-1',
        name: 'topic',
        metadata_id: 'meta-1',
        comparison_operator: ComparisonOperator.contains,
        value: 'agent',
      },
    ],
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
      createDataset({
        doc_metadata: [createMetadata(), createMetadata({ id: 'meta-2', name: 'shared' })],
      }),
      createDataset({
        id: 'dataset-2',
        doc_metadata: [
          createMetadata({ id: 'meta-3', name: 'shared' }),
          createMetadata({ id: 'meta-4', name: 'language' }),
        ],
      }),
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
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  const renderPanel = () => {
    const { queryClient } = createConsoleQueryWrapper()
    seedToolProviders(queryClient, {
      builtInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
    return renderWorkflowFlowComponent(
      <Panel id="knowledge-node" data={createData()} panelProps={panelProps} />,
      { queryClient, nodes: [], edges: [] },
    )
  }

  it('offers only metadata shared by all selected datasets', () => {
    renderPanel()
    expect(screen.getByRole('list', { name: 'Shared metadata' })).toHaveTextContent('shared')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['shared'])
  })

  it('has no shared metadata when datasets have disjoint fields', () => {
    mockUseConfig.mockReturnValue(
      createConfigResult({
        selectedDatasets: [
          createDataset({ doc_metadata: [createMetadata()] }),
          createDataset({ id: 'dataset-2', doc_metadata: [] }),
        ],
      }),
    )
    renderPanel()
    expect(screen.getByRole('list', { name: 'Shared metadata' })).toBeEmptyDOMElement()
  })

  it('removes the chosen dataset through the real dataset list', async () => {
    renderPanel()
    await userEvent
      .setup()
      .click(screen.getAllByRole('button', { name: 'common.operation.remove' })[0]!)
    expect(handleOnDatasetsChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'dataset-2' }),
    ])
  })

  it('hides dataset editing controls in read-only mode', () => {
    mockUseConfig.mockReturnValue(
      createConfigResult({ readOnly: true, showImageQueryVarSelector: false }),
    )
    renderPanel()
    expect(screen.getAllByText('Dataset Name')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Add knowledge' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('workflowModels.nodes.knowledgeRetrieval.queryAttachment'),
    ).not.toBeInTheDocument()
  })
})
