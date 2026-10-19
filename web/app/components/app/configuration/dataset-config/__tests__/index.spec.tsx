import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ComponentProps } from 'react'
import type { DatasetConfigs } from '@/models/debug'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import DebugConfigurationContext from '@/context/debug-configuration'
import { DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import {
  createDatasetConfigsFixture,
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { ModelModeType, RETRIEVE_TYPE } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetConfig from '../index'

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) =>
  renderWithConsoleState(ui, {
    wrapper: createConsoleQueryWrapper({ accountProfile: { id: 'user-123' } }).wrapper,
  })

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(() => ({
    currentModel: { model: 'rerank-model' },
    currentProvider: { provider: 'openai' },
  })),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'user-123' },
    workspacePermissionKeys: [],
  }))
})

vi.mock('../../debug/hooks', () => ({
  useFormattingChangedDispatcher: vi.fn(() => vi.fn()),
}))

vi.mock('../card-item', () => ({
  default: ({
    config,
    onRemove,
    onSave,
    editable,
  }: ComponentProps<typeof import('../card-item').default>) => (
    <div data-testid={`card-item-${config.id}`}>
      <span>{config.name}</span>
      {editable && (
        <button onClick={() => onSave({ ...config, name: 'Updated dataset' })}>Edit</button>
      )}
      <button onClick={() => onRemove(config.id)}>Remove</button>
    </div>
  ),
}))

vi.mock('../params-config', () => ({
  default: ({
    disabled,
    selectedDatasets,
  }: ComponentProps<typeof import('../params-config').default>) => (
    <button data-testid="params-config" disabled={disabled}>
      Params ({selectedDatasets.length})
    </button>
  ),
}))

vi.mock(
  '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter',
  () => ({
    default: ({
      metadataList,
      metadataFilterMode,
      handleMetadataFilterModeChange,
      handleAddCondition,
      handleRemoveCondition,
      handleUpdateCondition,
      handleToggleConditionLogicalOperator,
      handleMetadataModelChange,
      handleMetadataCompletionParamsChange,
    }: ComponentProps<
      typeof import('@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter').default
    >) => (
      <div data-testid="metadata-filter">
        <span data-testid="metadata-list-count">{metadataList?.length ?? 0}</span>
        <span data-testid="metadata-names">{metadataList?.map((item) => item.name).join(',')}</span>
        <select
          value={metadataFilterMode}
          onChange={(e) =>
            handleMetadataFilterModeChange(e.target.value as MetadataFilteringModeEnum)
          }
        >
          <option value="disabled">Disabled</option>
          <option value="automatic">Automatic</option>
          <option value="manual">Manual</option>
        </select>
        <button onClick={() => handleAddCondition({ id: 'test', name: 'test', type: 'string' })}>
          Add Condition
        </button>
        <button
          onClick={() => handleAddCondition({ id: 'priority', name: 'priority', type: 'number' })}
        >
          Add Number Condition
        </button>
        <button onClick={() => handleRemoveCondition('condition-id')}>Remove Condition</button>
        <button
          onClick={() =>
            handleUpdateCondition('condition-id', {
              id: 'condition-id',
              name: 'updated',
              comparison_operator: ComparisonOperator.equal,
            })
          }
        >
          Update Condition
        </button>
        <button onClick={handleToggleConditionLogicalOperator}>Toggle Operator</button>
        <button
          onClick={() =>
            handleMetadataModelChange?.({ provider: 'openai', modelId: 'gpt-4o-mini' })
          }
        >
          Change Metadata Model
        </button>
        <button onClick={() => handleMetadataCompletionParamsChange?.({ temperature: 0.3 })}>
          Change Metadata Params
        </button>
      </div>
    ),
  }),
)

const mockConfigContext = createDebugConfigurationFixture({
  mode: 'chat' as const,
  modelModeType: ModelModeType.chat,
  isAgent: false,
  dataSets: [],
  setDataSets: vi.fn(),
  modelConfig: createModelConfigFixture({
    configs: { prompt_template: '', prompt_variables: [] },
  }),
  setModelConfig: vi.fn(),
  showSelectDataSet: vi.fn(),
  datasetConfigs: {
    retrieval_model: RETRIEVE_TYPE.multiWay,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 4,
    score_threshold_enabled: false,
    score_threshold: 0.7,
    metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
    metadata_filtering_conditions: undefined,
    datasets: {
      datasets: [],
    },
  } as DatasetConfigs,
  datasetConfigsRef: {
    current: {
      retrieval_model: RETRIEVE_TYPE.multiWay,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: 4,
      score_threshold_enabled: false,
      score_threshold: 0.7,
      metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
      metadata_filtering_conditions: undefined,
      datasets: {
        datasets: [],
      },
    } as DatasetConfigs,
  },
  setDatasetConfigs: vi.fn(),
  setRerankSettingModalOpen: vi.fn(),
})

const createMockDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
): DatasetDetailWithPartialMembersResponse => {
  const defaultDataset: DatasetDetailWithPartialMembersResponse = {
    ...createDatasetFixture({
      permission_keys: [DatasetACLPermission.Edit, DatasetACLPermission.Use],
    }),
    id: 'dataset-1',
    name: 'Test Dataset',
    icon_info: {
      icon: '📘',
      icon_type: 'emoji',
      icon_background: '#FFEAD5',
      icon_url: '',
    },
    description: 'Test dataset description',
    permission: PermissionLevel.onlyMe,
    data_source_type: DataSourceType.FILE,
    indexing_technique: 'high_quality',
    author_name: 'Test Author',
    created_by: 'user-123',
    maintainer: 'user-123',
    updated_by: 'user-123',
    updated_at: Date.now(),
    app_count: 0,
    doc_form: 'text',
    document_count: 10,
    total_available_documents: 10,
    word_count: 1000,
    provider: 'dify',
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    embedding_available: true,
    retrieval_model_dict: {
      search_method: 'semantic_search',
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: 4,
      score_threshold_enabled: false,
      score_threshold: 0.7,
    },
    tags: [],
    external_knowledge_info: {
      external_knowledge_id: '',
      external_knowledge_api_id: '',
      external_knowledge_api_name: '',
      external_knowledge_api_endpoint: '',
    },
    external_retrieval_model: {
      top_k: 2,
      score_threshold: 0.5,
      score_threshold_enabled: true,
    },
    built_in_field_enabled: true,
    doc_metadata: [
      { id: 'category', name: 'category', type: 'string' },
      { id: 'priority', name: 'priority', type: 'number' },
    ],
    keyword_number: 3,
    pipeline_id: 'pipeline-123',
    is_published: true,
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
    ...overrides,
  }
  return defaultDataset
}

const renderDatasetConfig = (contextOverrides: Partial<typeof mockConfigContext> = {}) => {
  const mergedContext = { ...mockConfigContext, ...contextOverrides }
  mergedContext.datasetConfigsRef = contextOverrides.datasetConfigsRef ?? {
    current: mergedContext.datasetConfigs,
  }

  return render(
    <DebugConfigurationContext.Provider value={mergedContext}>
      <DatasetConfig />
    </DebugConfigurationContext.Provider>,
  )
}

describe('DatasetConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockConfigContext.dataSets = []
    mockConfigContext.setDataSets = vi.fn()
    mockConfigContext.setModelConfig = vi.fn()
    mockConfigContext.setDatasetConfigs = vi.fn()
    mockConfigContext.setRerankSettingModalOpen = vi.fn()
  })

  describe('Rendering', () => {
    it('should display empty state message when no datasets are configured', () => {
      renderDatasetConfig()

      expect(screen.getByText(/no.*data/i))!.toBeInTheDocument()
      expect(screen.getByTestId('params-config'))!.toBeDisabled()
    })

    it('should render dataset cards and enable parameters when datasets exist', () => {
      const dataset = createMockDataset()
      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId(`card-item-${dataset.id}`))!.toBeInTheDocument()
      expect(screen.getByText(dataset.name))!.toBeInTheDocument()
      expect(screen.getByTestId('params-config')).not.toBeDisabled()
    })

    it('should hide parameters configuration when in agent mode', () => {
      renderDatasetConfig({
        isAgent: true,
      })

      expect(screen.queryByTestId('params-config')).not.toBeInTheDocument()
    })
  })

  describe('Dataset Management', () => {
    it('should open dataset selection modal when add button is clicked', async () => {
      const user = userEvent.setup()
      renderDatasetConfig()

      const addButton = screen.getByText('common.operation.add')
      await user.click(addButton)

      expect(mockConfigContext.showSelectDataSet).toHaveBeenCalledTimes(1)
    })

    it('should remove dataset and update configuration when remove button is clicked', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()
      renderDatasetConfig({
        dataSets: [dataset],
      })

      const removeButton = screen.getByText('Remove')
      await user.click(removeButton)

      expect(mockConfigContext.setDataSets).toHaveBeenCalledWith([])
    })

    it('should trigger rerank setting modal when removing dataset requires rerank configuration', async () => {
      const user = userEvent.setup()

      const dataset = createMockDataset()
      renderDatasetConfig({
        dataSets: [dataset, createMockDataset({ id: 'external-dataset', provider: 'external' })],
      })

      const removeButton = screen.getAllByText('Remove')[0]!
      await user.click(removeButton)

      expect(mockConfigContext.setRerankSettingModalOpen).toHaveBeenCalledWith(true)
    })

    it('replaces the edited dataset while preserving its identity', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()

      renderDatasetConfig({
        dataSets: [dataset],
      })

      const editButton = screen.getByText('Edit')
      await user.click(editButton)

      expect(mockConfigContext.setDataSets).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: dataset.id,
            name: 'Updated dataset',
            editable: true,
          }),
        ]),
      )
    })

    it('should disable dataset editing when ACL does not grant edit even if legacy dataset permission allows it', () => {
      const dataset = createMockDataset({
        permission: PermissionLevel.allTeamMembers,
        permission_keys: [DatasetACLPermission.Use],
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId(`card-item-${dataset.id}`))!.toBeInTheDocument()
      expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    })
  })

  describe('Context Variables', () => {
    it('should not show context variable selector in chat mode', () => {
      const dataset = createMockDataset()
      renderDatasetConfig({
        mode: 'chat' as const,
        dataSets: [dataset],
        modelConfig: createModelConfigFixture({
          configs: {
            prompt_template: '',
            prompt_variables: [
              { key: 'query', name: 'Query', type: 'string', is_context_var: false },
            ],
          },
        }),
      })

      expect(
        screen.queryByText('appDebug.feature.dataSet.queryVariable.title'),
      ).not.toBeInTheDocument()
    })

    it('should handle context variable selection', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()
      renderDatasetConfig({
        mode: 'completion' as const,
        dataSets: [dataset],
        modelConfig: createModelConfigFixture({
          configs: {
            prompt_template: '',
            prompt_variables: [
              { key: 'query', name: 'Query', type: 'string', is_context_var: false },
              { key: 'context', name: 'Context', type: 'string', is_context_var: true },
            ],
          },
        }),
      })

      await user.click(screen.getByRole('button', { name: /context/ }))
      await user.click(await screen.findByText('query'))
      expect(mockConfigContext.setModelConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          configs: {
            prompt_template: '',
            prompt_variables: [
              { key: 'query', name: 'Query', type: 'string', is_context_var: true },
              { key: 'context', name: 'Context', type: 'string', is_context_var: false },
            ],
          },
        }),
      )
    })
  })

  describe('Metadata Filtering', () => {
    it('should handle metadata filter mode change', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()
      const updatedDatasetConfigs = {
        ...mockConfigContext.datasetConfigs,
        metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
      }

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: updatedDatasetConfigs,
      })

      const select = within(screen.getByTestId('metadata-filter')).getByDisplayValue('Disabled')
      await user.selectOptions(select, 'automatic')

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_filtering_mode: MetadataFilteringModeEnum.automatic,
        }),
      )
    })

    it('should handle adding metadata conditions', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()
      const baseDatasetConfigs = {
        ...mockConfigContext.datasetConfigs,
      }

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: baseDatasetConfigs,
      })

      const addButton = within(screen.getByTestId('metadata-filter')).getByText('Add Condition')
      await user.click(addButton)

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_filtering_conditions: expect.objectContaining({
            logical_operator: LogicalOperator.and,
            conditions: expect.arrayContaining([
              expect.objectContaining({
                id: expect.any(String),
                name: 'test',
                comparison_operator: ComparisonOperator.is,
              }),
            ]),
          }),
        }),
      )
    })

    it('should append numeric metadata conditions with the equal operator when conditions already exist', async () => {
      renderDatasetConfig({
        dataSets: [createMockDataset()],
        datasetConfigs: createDatasetConfigsFixture({
          ...mockConfigContext.datasetConfigs,
          metadata_filtering_conditions: {
            logical_operator: LogicalOperator.and,
            conditions: [
              {
                id: 'condition-id',
                metadata_id: 'category',
                name: 'category',
                comparison_operator: ComparisonOperator.is,
              },
            ],
          },
        }),
        datasetConfigsRef: {
          current: createDatasetConfigsFixture({
            ...mockConfigContext.datasetConfigsRef.current,
            metadata_filtering_conditions: {
              logical_operator: LogicalOperator.and,
              conditions: [
                {
                  id: 'condition-id',
                  metadata_id: 'category',
                  name: 'category',
                  comparison_operator: ComparisonOperator.is,
                },
              ],
            },
          }),
        },
      })

      const user = userEvent.setup()
      await user.click(
        within(screen.getByTestId('metadata-filter')).getByText('Add Number Condition'),
      )

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_filtering_conditions: expect.objectContaining({
            conditions: expect.arrayContaining([
              expect.objectContaining({
                name: 'priority',
                comparison_operator: ComparisonOperator.equal,
              }),
            ]),
          }),
        }),
      )
    })

    it('should handle removing metadata conditions', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()

      const datasetConfigsWithConditions = {
        ...mockConfigContext.datasetConfigs,
        metadata_filtering_conditions: {
          logical_operator: LogicalOperator.and,
          conditions: [
            { id: 'condition-id', name: 'test', comparison_operator: ComparisonOperator.is },
          ],
        },
      }

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: datasetConfigsWithConditions,
      })

      const removeButton = within(screen.getByTestId('metadata-filter')).getByText(
        'Remove Condition',
      )
      await user.click(removeButton)

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_filtering_conditions: expect.objectContaining({
            conditions: [],
          }),
        }),
      )
    })

    it('should handle updating metadata conditions', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()

      const datasetConfigsWithConditions = {
        ...mockConfigContext.datasetConfigs,
        metadata_filtering_conditions: {
          logical_operator: LogicalOperator.and,
          conditions: [
            { id: 'condition-id', name: 'test', comparison_operator: ComparisonOperator.is },
          ],
        },
      }

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: datasetConfigsWithConditions,
      })

      const updateButton = within(screen.getByTestId('metadata-filter')).getByText(
        'Update Condition',
      )
      await user.click(updateButton)

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_filtering_conditions: expect.objectContaining({
            conditions: expect.arrayContaining([
              expect.objectContaining({
                name: 'updated',
              }),
            ]),
          }),
        }),
      )
    })

    it('should handle toggling logical operator', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()

      const datasetConfigsWithConditions = {
        ...mockConfigContext.datasetConfigs,
        metadata_filtering_conditions: {
          logical_operator: LogicalOperator.and,
          conditions: [
            { id: 'condition-id', name: 'test', comparison_operator: ComparisonOperator.is },
          ],
        },
      }

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: datasetConfigsWithConditions,
      })

      const toggleButton = within(screen.getByTestId('metadata-filter')).getByText(
        'Toggle Operator',
      )
      await user.click(toggleButton)

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_filtering_conditions: expect.objectContaining({
            logical_operator: LogicalOperator.or,
          }),
        }),
      )
    })
  })

  describe('Edge Cases', () => {
    it('omits metadata choices when the dataset has no metadata field', () => {
      const dataset = createMockDataset({
        doc_metadata: undefined,
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId('metadata-filter'))!.toBeInTheDocument()
      expect(screen.getByTestId('metadata-list-count'))!.toHaveTextContent('0')
    })

    it('should handle empty doc_metadata array', () => {
      const dataset = createMockDataset({
        doc_metadata: [],
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId('metadata-filter'))!.toBeInTheDocument()
      expect(screen.getByTestId('metadata-list-count'))!.toHaveTextContent('0')
    })

    it('hides the context selector when no dataset is selected', () => {
      renderDatasetConfig({
        mode: 'completion' as const,
        dataSets: [],
        modelConfig: createModelConfigFixture({
          configs: { prompt_template: '', prompt_variables: [] },
        }),
      })

      expect(
        screen.queryByText('appDebug.feature.dataSet.queryVariable.title'),
      ).not.toBeInTheDocument()
    })
  })

  describe('Component Integration', () => {
    it('offers only metadata fields shared by all selected datasets', () => {
      const datasets = [
        createMockDataset({
          doc_metadata: [
            { id: 'category', name: 'category', type: 'string' },
            { id: 'tags', name: 'tags', type: 'string' },
          ],
        }),
        createMockDataset({
          id: 'ds2',
          doc_metadata: [
            { id: 'category', name: 'category', type: 'string' },
            { id: 'priority', name: 'priority', type: 'number' },
          ],
        }),
      ]

      renderDatasetConfig({
        dataSets: datasets,
      })

      const metadataFilter = screen.getByTestId('metadata-filter')
      expect(metadataFilter)!.toBeInTheDocument()

      expect(screen.getByTestId('metadata-names').textContent).toBe('category')
    })
  })

  describe('Model Configuration', () => {
    it('should handle metadata model change', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: createDatasetConfigsFixture({
          ...mockConfigContext.datasetConfigs,
          metadata_model_config: {
            provider: 'openai',
            name: 'gpt-3.5-turbo',
            mode: 'chat' as const,
            completion_params: { temperature: 0.7 },
          },
        }),
      })

      const metadataFilter = screen.getByTestId('metadata-filter')
      expect(metadataFilter)!.toBeInTheDocument()

      await user.click(within(metadataFilter).getByText('Change Metadata Model'))

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_model_config: {
            provider: 'openai',
            name: 'gpt-4o-mini',
            mode: 'chat' as const,
            completion_params: { temperature: 0.7 },
          },
        }),
      )
    })

    it('should handle metadata completion params change', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: createDatasetConfigsFixture({
          ...mockConfigContext.datasetConfigs,
          metadata_model_config: {
            provider: 'openai',
            name: 'gpt-3.5-turbo',
            mode: 'chat' as const,
            completion_params: { temperature: 0.5, max_tokens: 100 },
          },
        }),
      })

      const metadataFilter = screen.getByTestId('metadata-filter')
      expect(metadataFilter)!.toBeInTheDocument()

      await user.click(within(metadataFilter).getByText('Change Metadata Params'))

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_model_config: {
            provider: 'openai',
            name: 'gpt-3.5-turbo',
            mode: 'chat',
            completion_params: { temperature: 0.3 },
          },
        }),
      )
    })
  })

  describe('Dataset Reordering and Management', () => {
    it('removes only the selected dataset', async () => {
      const user = userEvent.setup()
      const datasets = [
        createMockDataset({ id: 'ds1', name: 'Dataset 1' }),
        createMockDataset({ id: 'ds2', name: 'Dataset 2' }),
      ]

      renderDatasetConfig({
        dataSets: datasets,
      })

      const removeButton1 = screen.getAllByText('Remove')[0]
      await user.click(removeButton1!)

      expect(mockConfigContext.setDataSets).toHaveBeenCalledWith([datasets[1]])
    })
  })
})
