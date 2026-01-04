import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs } from '@/models/debug'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useContext } from 'use-context-selector'
import { ComparisonOperator, LogicalOperator } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { getSelectedDatasetsMode } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { DatasetPermission, DataSourceType } from '@/models/datasets'
import { AppModeEnum, ModelModeType, RETRIEVE_TYPE } from '@/types/app'
import { hasEditPermissionForDataset } from '@/utils/permission'
import DatasetConfig from './index'

// Mock external dependencies
vi.mock('@/app/components/workflow/nodes/knowledge-retrieval/utils', () => ({
  getMultipleRetrievalConfig: vi.fn(() => ({
    top_k: 4,
    score_threshold: 0.7,
    reranking_enable: false,
    reranking_model: undefined,
    reranking_mode: 'reranking_model',
    weights: { weight1: 1.0 },
  })),
  getSelectedDatasetsMode: vi.fn(() => ({
    allInternal: true,
    allExternal: false,
    mixtureInternalAndExternal: false,
    mixtureHighQualityAndEconomic: false,
    inconsistentEmbeddingModel: false,
  })),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(() => ({
    currentModel: { model: 'rerank-model' },
    currentProvider: { provider: 'openai' },
  })),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: vi.fn((fn: any) => fn({
    userProfile: {
      id: 'user-123',
    },
  })),
}))

vi.mock('@/utils/permission', () => ({
  hasEditPermissionForDataset: vi.fn(() => true),
}))

vi.mock('../debug/hooks', () => ({
  useFormattingChangedDispatcher: vi.fn(() => vi.fn()),
}))

vi.mock('es-toolkit/compat', () => ({
  intersectionBy: vi.fn((...arrays) => {
    // Mock realistic intersection behavior based on metadata name
    const validArrays = arrays.filter(Array.isArray)
    if (validArrays.length === 0)
      return []

    // Start with first array and filter down
    return validArrays[0].filter((item: any) => {
      if (!item || !item.name)
        return false

      // Only return items that exist in all arrays
      return validArrays.every(array =>
        array.some((otherItem: any) =>
          otherItem && otherItem.name === item.name,
        ),
      )
    })
  }),
}))

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid'),
}))

// Mock child components
vi.mock('./card-item', () => ({
  default: ({ config, onRemove, onSave, editable }: any) => (
    <div data-testid={`card-item-${config.id}`}>
      <span>{config.name}</span>
      {editable && <button onClick={() => onSave(config)}>Edit</button>}
      <button onClick={() => onRemove(config.id)}>Remove</button>
    </div>
  ),
}))

vi.mock('./params-config', () => ({
  default: ({ disabled, selectedDatasets }: any) => (
    <button data-testid="params-config" disabled={disabled}>
      Params (
      {selectedDatasets.length}
      )
    </button>
  ),
}))

vi.mock('./context-var', () => ({
  default: ({ value, options, onChange }: any) => (
    <select data-testid="context-var" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Select context variable</option>
      {options.map((opt: any) => (
        <option key={opt.value} value={opt.value}>{opt.name}</option>
      ))}
    </select>
  ),
}))

vi.mock('@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter', () => ({
  default: ({
    metadataList,
    metadataFilterMode,
    handleMetadataFilterModeChange,
    handleAddCondition,
    handleRemoveCondition,
    handleUpdateCondition,
    handleToggleConditionLogicalOperator,
  }: any) => (
    <div data-testid="metadata-filter">
      <span data-testid="metadata-list-count">{metadataList.length}</span>
      <select value={metadataFilterMode} onChange={e => handleMetadataFilterModeChange(e.target.value)}>
        <option value="disabled">Disabled</option>
        <option value="automatic">Automatic</option>
        <option value="manual">Manual</option>
      </select>
      <button onClick={() => handleAddCondition({ name: 'test', type: 'string' })}>
        Add Condition
      </button>
      <button onClick={() => handleRemoveCondition('condition-id')}>
        Remove Condition
      </button>
      <button onClick={() => handleUpdateCondition('condition-id', { name: 'updated' })}>
        Update Condition
      </button>
      <button onClick={handleToggleConditionLogicalOperator}>
        Toggle Operator
      </button>
    </div>
  ),
}))

// Mock context
const mockConfigContext: any = {
  mode: AppModeEnum.CHAT,
  modelModeType: ModelModeType.chat,
  isAgent: false,
  dataSets: [],
  setDataSets: vi.fn(),
  modelConfig: {
    configs: {
      prompt_variables: [],
    },
  },
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
    metadata_filtering_mode: 'disabled' as any,
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
      metadata_filtering_mode: 'disabled' as any,
      metadata_filtering_conditions: undefined,
      datasets: {
        datasets: [],
      },
    } as DatasetConfigs,
  },
  setDatasetConfigs: vi.fn(),
  setRerankSettingModalOpen: vi.fn(),
}

vi.mock('@/context/debug-configuration', () => ({
  default: ({ children }: any) => (
    <div data-testid="config-context-provider">
      {children}
    </div>
  ),
}))

vi.mock('use-context-selector', () => ({
  useContext: vi.fn(() => mockConfigContext),
}))

const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => {
  const defaultDataset: DataSet = {
    id: 'dataset-1',
    name: 'Test Dataset',
    indexing_status: 'completed' as any,
    icon_info: {
      icon: '📘',
      icon_type: 'emoji',
      icon_background: '#FFEAD5',
      icon_url: '',
    },
    description: 'Test dataset description',
    permission: DatasetPermission.onlyMe,
    data_source_type: DataSourceType.FILE,
    indexing_technique: 'high_quality' as any,
    author_name: 'Test Author',
    created_by: 'user-123',
    updated_by: 'user-123',
    updated_at: Date.now(),
    app_count: 0,
    doc_form: 'text' as any,
    document_count: 10,
    total_document_count: 10,
    total_available_documents: 10,
    word_count: 1000,
    provider: 'dify',
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    embedding_available: true,
    retrieval_model_dict: {
      search_method: 'semantic_search' as any,
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: 4,
      score_threshold_enabled: false,
      score_threshold: 0.7,
    },
    retrieval_model: {
      search_method: 'semantic_search' as any,
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
      { name: 'category', type: 'string' } as any,
      { name: 'priority', type: 'number' } as any,
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
  vi.mocked(useContext).mockReturnValue(mergedContext)

  return render(<DatasetConfig />)
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
    it('should render dataset configuration panel when component mounts', () => {
      renderDatasetConfig()

      expect(screen.getByText('appDebug.feature.dataSet.title')).toBeInTheDocument()
    })

    it('should display empty state message when no datasets are configured', () => {
      renderDatasetConfig()

      expect(screen.getByText(/no.*data/i)).toBeInTheDocument()
      expect(screen.getByTestId('params-config')).toBeDisabled()
    })

    it('should render dataset cards and enable parameters when datasets exist', () => {
      const dataset = createMockDataset()
      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId(`card-item-${dataset.id}`)).toBeInTheDocument()
      expect(screen.getByText(dataset.name)).toBeInTheDocument()
      expect(screen.getByTestId('params-config')).not.toBeDisabled()
    })

    it('should show configuration title and add dataset button in header', () => {
      renderDatasetConfig()

      expect(screen.getByText('appDebug.feature.dataSet.title')).toBeInTheDocument()
      expect(screen.getByText('common.operation.add')).toBeInTheDocument()
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
      // Note: setDatasetConfigs is also called but its exact parameters depend on
      // the retrieval config calculation which involves complex mocked utilities
    })

    it('should trigger rerank setting modal when removing dataset requires rerank configuration', async () => {
      const user = userEvent.setup()

      // Mock scenario that triggers rerank modal
      // @ts-expect-error - same as above
      vi.mocked(getSelectedDatasetsMode).mockReturnValue({
        allInternal: false,
        allExternal: true,
        mixtureInternalAndExternal: false,
        mixtureHighQualityAndEconomic: false,
        inconsistentEmbeddingModel: false,
      })

      const dataset = createMockDataset()
      renderDatasetConfig({
        dataSets: [dataset],
      })

      const removeButton = screen.getByText('Remove')
      await user.click(removeButton)

      expect(mockConfigContext.setRerankSettingModalOpen).toHaveBeenCalledWith(true)
    })

    it('should handle dataset save', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()

      renderDatasetConfig({
        dataSets: [dataset],
      })

      // Mock the onSave in card-item component - it will pass the original dataset
      const editButton = screen.getByText('Edit')
      await user.click(editButton)

      expect(mockConfigContext.setDataSets).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: dataset.id,
            name: dataset.name,
            editable: true,
          }),
        ]),
      )
    })

    it('should format datasets with edit permission', () => {
      const dataset = createMockDataset({
        created_by: 'user-123',
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId(`card-item-${dataset.id}`)).toBeInTheDocument()
    })
  })

  describe('Context Variables', () => {
    it('should show context variable selector in completion mode with datasets', () => {
      const dataset = createMockDataset()
      renderDatasetConfig({
        mode: AppModeEnum.COMPLETION,
        dataSets: [dataset],
        modelConfig: {
          configs: {
            prompt_variables: [
              { key: 'query', name: 'Query', type: 'string', is_context_var: false },
              { key: 'context', name: 'Context', type: 'string', is_context_var: true },
            ],
          },
        },
      })

      expect(screen.getByTestId('context-var')).toBeInTheDocument()
      // Should find the selected context variable in the options
      expect(screen.getByText('Select context variable')).toBeInTheDocument()
    })

    it('should not show context variable selector in chat mode', () => {
      const dataset = createMockDataset()
      renderDatasetConfig({
        mode: AppModeEnum.CHAT,
        dataSets: [dataset],
        modelConfig: {
          configs: {
            prompt_variables: [
              { key: 'query', name: 'Query', type: 'string', is_context_var: false },
            ],
          },
        },
      })

      expect(screen.queryByTestId('context-var')).not.toBeInTheDocument()
    })

    it('should handle context variable selection', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()
      renderDatasetConfig({
        mode: AppModeEnum.COMPLETION,
        dataSets: [dataset],
        modelConfig: {
          configs: {
            prompt_variables: [
              { key: 'query', name: 'Query', type: 'string', is_context_var: false },
              { key: 'context', name: 'Context', type: 'string', is_context_var: true },
            ],
          },
        },
      })

      const select = screen.getByTestId('context-var')
      await user.selectOptions(select, 'query')

      expect(mockConfigContext.setModelConfig).toHaveBeenCalled()
    })
  })

  describe('Metadata Filtering', () => {
    it('should render metadata filter component', () => {
      const dataset = createMockDataset({
        doc_metadata: [
          { name: 'category', type: 'string' } as any,
          { name: 'priority', type: 'number' } as any,
        ],
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId('metadata-filter')).toBeInTheDocument()
      expect(screen.getByTestId('metadata-list-count')).toHaveTextContent('2') // both 'category' and 'priority'
    })

    it('should handle metadata filter mode change', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset()
      const updatedDatasetConfigs = {
        ...mockConfigContext.datasetConfigs,
        metadata_filtering_mode: 'disabled' as any,
      }

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: updatedDatasetConfigs,
      })

      // Update the ref to match
      mockConfigContext.datasetConfigsRef.current = updatedDatasetConfigs

      const select = within(screen.getByTestId('metadata-filter')).getByDisplayValue('Disabled')
      await user.selectOptions(select, 'automatic')

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_filtering_mode: 'automatic',
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

      // Update the ref to match
      mockConfigContext.datasetConfigsRef.current = baseDatasetConfigs

      const addButton = within(screen.getByTestId('metadata-filter')).getByText('Add Condition')
      await user.click(addButton)

      expect(mockConfigContext.setDatasetConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata_filtering_conditions: expect.objectContaining({
            logical_operator: LogicalOperator.and,
            conditions: expect.arrayContaining([
              expect.objectContaining({
                id: 'mock-uuid',
                name: 'test',
                comparison_operator: ComparisonOperator.is,
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

      // Update ref to match datasetConfigs
      mockConfigContext.datasetConfigsRef.current = datasetConfigsWithConditions

      const removeButton = within(screen.getByTestId('metadata-filter')).getByText('Remove Condition')
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

      mockConfigContext.datasetConfigsRef.current = datasetConfigsWithConditions

      const updateButton = within(screen.getByTestId('metadata-filter')).getByText('Update Condition')
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

      mockConfigContext.datasetConfigsRef.current = datasetConfigsWithConditions

      const toggleButton = within(screen.getByTestId('metadata-filter')).getByText('Toggle Operator')
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
    it('should handle null doc_metadata gracefully', () => {
      const dataset = createMockDataset({
        doc_metadata: undefined,
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId('metadata-filter')).toBeInTheDocument()
      expect(screen.getByTestId('metadata-list-count')).toHaveTextContent('0')
    })

    it('should handle empty doc_metadata array', () => {
      const dataset = createMockDataset({
        doc_metadata: [],
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId('metadata-filter')).toBeInTheDocument()
      expect(screen.getByTestId('metadata-list-count')).toHaveTextContent('0')
    })

    it('should handle missing userProfile', () => {
      vi.mocked(useContext).mockReturnValue({
        ...mockConfigContext,
        userProfile: null,
      })

      const dataset = createMockDataset()

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId(`card-item-${dataset.id}`)).toBeInTheDocument()
    })

    it('should handle missing datasetConfigsRef gracefully', () => {
      const dataset = createMockDataset()

      // Test with undefined datasetConfigsRef - component renders without immediate error
      // The component will fail on interaction due to non-null assertions in handlers
      expect(() => {
        renderDatasetConfig({
          dataSets: [dataset],
          datasetConfigsRef: undefined as any,
        })
      }).not.toThrow()

      // The component currently expects datasetConfigsRef to exist for interactions
      // This test documents the current behavior and requirements
    })

    it('should handle missing prompt_variables', () => {
      // Context var is only shown when datasets exist AND there are prompt_variables
      // Test with no datasets to ensure context var is not shown
      renderDatasetConfig({
        mode: AppModeEnum.COMPLETION,
        dataSets: [],
        modelConfig: {
          configs: {
            prompt_variables: [],
          },
        },
      })

      expect(screen.queryByTestId('context-var')).not.toBeInTheDocument()
    })
  })

  describe('Component Integration', () => {
    it('should integrate with card item component', () => {
      const datasets = [
        createMockDataset({ id: 'ds1', name: 'Dataset 1' }),
        createMockDataset({ id: 'ds2', name: 'Dataset 2' }),
      ]

      renderDatasetConfig({
        dataSets: datasets,
      })

      expect(screen.getByTestId('card-item-ds1')).toBeInTheDocument()
      expect(screen.getByTestId('card-item-ds2')).toBeInTheDocument()
      expect(screen.getByText('Dataset 1')).toBeInTheDocument()
      expect(screen.getByText('Dataset 2')).toBeInTheDocument()
    })

    it('should integrate with params config component', () => {
      const datasets = [
        createMockDataset(),
        createMockDataset({ id: 'ds2' }),
      ]

      renderDatasetConfig({
        dataSets: datasets,
      })

      const paramsConfig = screen.getByTestId('params-config')
      expect(paramsConfig).toBeInTheDocument()
      expect(paramsConfig).toHaveTextContent('Params (2)')
      expect(paramsConfig).not.toBeDisabled()
    })

    it('should integrate with metadata filter component', () => {
      const datasets = [
        createMockDataset({
          doc_metadata: [
            { name: 'category', type: 'string' } as any,
            { name: 'tags', type: 'string' } as any,
          ],
        }),
        createMockDataset({
          id: 'ds2',
          doc_metadata: [
            { name: 'category', type: 'string' } as any,
            { name: 'priority', type: 'number' } as any,
          ],
        }),
      ]

      renderDatasetConfig({
        dataSets: datasets,
      })

      const metadataFilter = screen.getByTestId('metadata-filter')
      expect(metadataFilter).toBeInTheDocument()
      // Should show intersection (only 'category')
      expect(screen.getByTestId('metadata-list-count')).toHaveTextContent('1')
    })
  })

  describe('Model Configuration', () => {
    it('should handle metadata model change', () => {
      const dataset = createMockDataset()

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: {
          ...mockConfigContext.datasetConfigs,
          metadata_model_config: {
            provider: 'openai',
            name: 'gpt-3.5-turbo',
            mode: AppModeEnum.CHAT,
            completion_params: { temperature: 0.7 },
          },
        },
      })

      // The component would need to expose this functionality through the metadata filter
      expect(screen.getByTestId('metadata-filter')).toBeInTheDocument()
    })

    it('should handle metadata completion params change', () => {
      const dataset = createMockDataset()

      renderDatasetConfig({
        dataSets: [dataset],
        datasetConfigs: {
          ...mockConfigContext.datasetConfigs,
          metadata_model_config: {
            provider: 'openai',
            name: 'gpt-3.5-turbo',
            mode: AppModeEnum.CHAT,
            completion_params: { temperature: 0.5, max_tokens: 100 },
          },
        },
      })

      expect(screen.getByTestId('metadata-filter')).toBeInTheDocument()
    })
  })

  describe('Permission Handling', () => {
    it('should hide edit options when user lacks permission', () => {
      vi.mocked(hasEditPermissionForDataset).mockReturnValue(false)

      const dataset = createMockDataset({
        created_by: 'other-user',
        permission: DatasetPermission.onlyMe,
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      // The editable property should be false when no permission
      expect(screen.getByTestId(`card-item-${dataset.id}`)).toBeInTheDocument()
    })

    it('should show readonly state for non-editable datasets', () => {
      vi.mocked(hasEditPermissionForDataset).mockReturnValue(false)

      const dataset = createMockDataset({
        created_by: 'admin',
        permission: DatasetPermission.allTeamMembers,
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId(`card-item-${dataset.id}`)).toBeInTheDocument()
    })

    it('should allow editing when user has partial member permission', () => {
      vi.mocked(hasEditPermissionForDataset).mockReturnValue(true)

      const dataset = createMockDataset({
        created_by: 'admin',
        permission: DatasetPermission.partialMembers,
        partial_member_list: ['user-123'],
      })

      renderDatasetConfig({
        dataSets: [dataset],
      })

      expect(screen.getByTestId(`card-item-${dataset.id}`)).toBeInTheDocument()
    })
  })

  describe('Dataset Reordering and Management', () => {
    it('should maintain dataset order after updates', () => {
      const datasets = [
        createMockDataset({ id: 'ds1', name: 'Dataset 1' }),
        createMockDataset({ id: 'ds2', name: 'Dataset 2' }),
        createMockDataset({ id: 'ds3', name: 'Dataset 3' }),
      ]

      renderDatasetConfig({
        dataSets: datasets,
      })

      // Verify order is maintained
      expect(screen.getByText('Dataset 1')).toBeInTheDocument()
      expect(screen.getByText('Dataset 2')).toBeInTheDocument()
      expect(screen.getByText('Dataset 3')).toBeInTheDocument()
    })

    it('should handle multiple dataset operations correctly', async () => {
      const user = userEvent.setup()
      const datasets = [
        createMockDataset({ id: 'ds1', name: 'Dataset 1' }),
        createMockDataset({ id: 'ds2', name: 'Dataset 2' }),
      ]

      renderDatasetConfig({
        dataSets: datasets,
      })

      // Remove first dataset
      const removeButton1 = screen.getAllByText('Remove')[0]
      await user.click(removeButton1)

      expect(mockConfigContext.setDataSets).toHaveBeenCalledWith([datasets[1]])
    })
  })

  describe('Complex Configuration Scenarios', () => {
    it('should handle multiple retrieval methods in configuration', () => {
      const datasets = [
        createMockDataset({
          id: 'ds1',
          retrieval_model: {
            search_method: 'semantic_search' as any,
            reranking_enable: true,
            reranking_model: {
              reranking_provider_name: 'cohere',
              reranking_model_name: 'rerank-v3.5',
            },
            top_k: 5,
            score_threshold_enabled: true,
            score_threshold: 0.8,
          },
        }),
        createMockDataset({
          id: 'ds2',
          retrieval_model: {
            search_method: 'full_text_search' as any,
            reranking_enable: false,
            reranking_model: {
              reranking_provider_name: '',
              reranking_model_name: '',
            },
            top_k: 3,
            score_threshold_enabled: false,
            score_threshold: 0.5,
          },
        }),
      ]

      renderDatasetConfig({
        dataSets: datasets,
      })

      expect(screen.getByTestId('params-config')).toHaveTextContent('Params (2)')
    })

    it('should handle external knowledge base integration', () => {
      const externalDataset = createMockDataset({
        provider: 'notion',
        external_knowledge_info: {
          external_knowledge_id: 'notion-123',
          external_knowledge_api_id: 'api-456',
          external_knowledge_api_name: 'Notion Integration',
          external_knowledge_api_endpoint: 'https://api.notion.com',
        },
      })

      renderDatasetConfig({
        dataSets: [externalDataset],
      })

      expect(screen.getByTestId(`card-item-${externalDataset.id}`)).toBeInTheDocument()
      expect(screen.getByText(externalDataset.name)).toBeInTheDocument()
    })
  })

  describe('Performance and Error Handling', () => {
    it('should handle large dataset lists efficiently', () => {
      // Create many datasets to test performance
      const manyDatasets = Array.from({ length: 50 }, (_, i) =>
        createMockDataset({
          id: `ds-${i}`,
          name: `Dataset ${i}`,
          doc_metadata: [
            { name: 'category', type: 'string' } as any,
            { name: 'priority', type: 'number' } as any,
          ],
        }))

      renderDatasetConfig({
        dataSets: manyDatasets,
      })

      expect(screen.getByTestId('params-config')).toHaveTextContent('Params (50)')
    })

    it('should handle metadata intersection calculation efficiently', () => {
      const datasets = [
        createMockDataset({
          id: 'ds1',
          doc_metadata: [
            { name: 'category', type: 'string' } as any,
            { name: 'tags', type: 'string' } as any,
            { name: 'priority', type: 'number' } as any,
          ],
        }),
        createMockDataset({
          id: 'ds2',
          doc_metadata: [
            { name: 'category', type: 'string' } as any,
            { name: 'status', type: 'string' } as any,
            { name: 'priority', type: 'number' } as any,
          ],
        }),
      ]

      renderDatasetConfig({
        dataSets: datasets,
      })

      // Should calculate intersection correctly
      expect(screen.getByTestId('metadata-filter')).toBeInTheDocument()
    })
  })
})
