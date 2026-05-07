import type {
  ComparisonOperator,
  MetadataFilteringCondition,
  MetadataShape,
} from '../types'
import type { DataSet, MetadataInDoc } from '@/models/datasets'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import {
  ChunkingMode,
  DatasetPermission,
  DataSourceType,
} from '@/models/datasets'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import { DatasetsDetailContext } from '../../../datasets-detail-store/provider'
import { createDatasetsDetailStore } from '../../../datasets-detail-store/store'
import { BlockEnum, VarType } from '../../../types'
import AddDataset from '../components/add-dataset'
import DatasetItem from '../components/dataset-item'
import DatasetList from '../components/dataset-list'
import AddCondition from '../components/metadata/add-condition'
import ConditionCommonVariableSelector from '../components/metadata/condition-list/condition-common-variable-selector'
import ConditionDate from '../components/metadata/condition-list/condition-date'
import ConditionItem from '../components/metadata/condition-list/condition-item'
import ConditionOperator from '../components/metadata/condition-list/condition-operator'
import ConditionValueMethod from '../components/metadata/condition-list/condition-value-method'
import ConditionVariableSelector from '../components/metadata/condition-list/condition-variable-selector'
import MetadataFilter from '../components/metadata/metadata-filter'
import MetadataFilterSelector from '../components/metadata/metadata-filter/metadata-filter-selector'
import MetadataTrigger from '../components/metadata/metadata-trigger'
import RetrievalConfig from '../components/retrieval-config'
import Node from '../node'
import {
  LogicalOperator,
  ComparisonOperator as MetadataComparisonOperator,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '../types'

const mockHasEditPermissionForDataset = vi.fn((
  _userId: string,
  _datasetConfig: { createdBy: string, partialMemberList: string[], permission: DatasetPermission },
) => true)
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

const createCondition = (overrides: Partial<MetadataFilteringCondition> = {}): MetadataFilteringCondition => ({
  id: 'condition-1',
  name: 'topic',
  metadata_id: 'meta-1',
  comparison_operator: MetadataComparisonOperator.contains,
  value: 'agent',
  ...overrides,
})

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { userProfile: { id: string } }) => unknown) => selector({
    userProfile: { id: 'user-1' },
  }),
  useAppContext: () => ({
    userProfile: {
      timezone: 'UTC',
    },
  }),
}))

vi.mock('@/utils/permission', () => ({
  hasEditPermissionForDataset: (
    userId: string,
    datasetConfig: { createdBy: string, partialMemberList: string[], permission: DatasetPermission },
  ) => mockHasEditPermissionForDataset(userId, datasetConfig),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
    desktop: 'desktop',
  },
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'High Quality',
  }),
}))

vi.mock('@/app/components/app/configuration/dataset-config/select-dataset', () => ({
  __esModule: true,
  default: ({ onSelect, onClose }: { onSelect: (datasets: DataSet[]) => void, onClose: () => void }) => (
    <div>
      <button type="button" onClick={() => onSelect([createDataset({ id: 'dataset-2', name: 'Selected Dataset' })])}>
        select-dataset
      </button>
      <button type="button" onClick={onClose}>
        close-select-dataset
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/app/configuration/dataset-config/settings-modal', () => ({
  __esModule: true,
  default: function MockSettingsModal({ currentDataset, onSave, onCancel }: { currentDataset: DataSet, onSave: (dataset: DataSet) => void, onCancel: () => void }) {
    const hasSavedRef = useRef(false)

    useEffect(() => {
      if (hasSavedRef.current)
        return

      hasSavedRef.current = true
      onSave(createDataset({ ...currentDataset, name: 'Updated Dataset' }))
    }, [currentDataset, onSave])

    return (
      <div>
        <div>{currentDataset.name}</div>
        <button type="button" onClick={onCancel}>
          cancel-settings
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/app/configuration/dataset-config/params-config/config-content', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (config: Record<string, unknown>, isRetrievalModeChange?: boolean) => void }) => (
    <div>
      <button
        type="button"
        onClick={() => onChange({
          retrieval_model: RETRIEVE_TYPE.multiWay,
          top_k: 8,
          score_threshold_enabled: true,
          score_threshold: 0.4,
          reranking_model: {
            reranking_provider_name: 'cohere',
            reranking_model_name: 'rerank-v3',
          },
          reranking_mode: 'weighted_score',
          weights: {
            weight_type: 'customized',
            vector_setting: {
              vector_weight: 0.7,
              embedding_provider_name: 'openai',
              embedding_model_name: 'text-embedding-3',
            },
            keyword_setting: {
              keyword_weight: 0.3,
            },
          },
          reranking_enable: true,
        })}
      >
        apply-retrieval-config
      </button>
      <button
        type="button"
        onClick={() => onChange({
          retrieval_model: RETRIEVE_TYPE.oneWay,
        }, true)}
      >
        change-retrieval-mode
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  __esModule: true,
  default: () => <div>model-parameter-modal</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-vars', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (valueSelector: string[], varItem: { type: VarType }) => void }) => (
    <button
      type="button"
      onClick={() => onChange(['node-1', 'field'], { type: VarType.string })}
    >
      pick-var
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable-tag', () => ({
  __esModule: true,
  default: ({ valueSelector }: { valueSelector: string[] }) => <div>{valueSelector.join('.')}</div>,
}))

vi.mock('../components/metadata/metadata-panel', () => ({
  __esModule: true,
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div>
      <div>metadata-panel</div>
      <button type="button" onClick={onCancel}>
        close-metadata-panel
      </button>
    </div>
  ),
}))

describe('knowledge-retrieval path', () => {
  const getDatasetItem = () => {
    const datasetItem = screen.getByText('Dataset Name').closest('.group\\/dataset-item')
    if (!(datasetItem instanceof HTMLElement))
      throw new Error('Dataset item container not found')
    return datasetItem
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasEditPermissionForDataset.mockReturnValue(true)
  })

  describe('Dataset controls', () => {
    it('should open dataset selector and forward selected datasets', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <AddDataset
          selectedIds={['dataset-1']}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByTestId('add-button'))
      await user.click(screen.getByText('select-dataset'))

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'dataset-2',
          name: 'Selected Dataset',
        }),
      ])
    })

    it('should support editing a dataset item', async () => {
      const onChange = vi.fn()

      render(
        <DatasetItem
          payload={createDataset({ is_multimodal: true })}
          onChange={onChange}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.getByText('Dataset Name')).toBeInTheDocument()
      const datasetItem = getDatasetItem()
      fireEvent.click(within(datasetItem).getByRole('button', { name: 'common.operation.edit' }))

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated Dataset' }))
      })
    })

    it('should support removing a dataset item', () => {
      const onRemove = vi.fn()

      render(
        <DatasetItem
          payload={createDataset({ is_multimodal: true })}
          onChange={vi.fn()}
          onRemove={onRemove}
        />,
      )

      const datasetItem = getDatasetItem()
      fireEvent.click(within(datasetItem).getByRole('button', { name: 'common.operation.remove' }))
      expect(onRemove).toHaveBeenCalled()
    })

    it('should render empty and populated dataset lists', () => {
      const onChange = vi.fn()

      const { rerender } = render(
        <DatasetList
          list={[]}
          onChange={onChange}
        />,
      )

      expect(screen.getByText('appDebug.datasetConfig.knowledgeTip')).toBeInTheDocument()

      rerender(
        <DatasetList
          list={[createDataset()]}
          onChange={onChange}
        />,
      )

      const datasetItem = getDatasetItem()
      fireEvent.click(within(datasetItem).getByRole('button', { name: 'common.operation.remove' }))

      expect(onChange).toHaveBeenCalledWith([])
    })
  })

  describe('Retrieval settings', () => {
    it('should open retrieval config and map config updates back to workflow payload', async () => {
      const user = userEvent.setup()
      const onRetrievalModeChange = vi.fn()
      const onMultipleRetrievalConfigChange = vi.fn()

      render(
        <RetrievalConfig
          payload={{
            retrieval_mode: RETRIEVE_TYPE.multiWay,
            multiple_retrieval_config: {
              top_k: 3,
              score_threshold: null,
            },
          }}
          onRetrievalModeChange={onRetrievalModeChange}
          onMultipleRetrievalConfigChange={onMultipleRetrievalConfigChange}
          rerankModalOpen
          onRerankModelOpenChange={vi.fn()}
          selectedDatasets={[createDataset()]}
        />,
      )

      await user.click(screen.getByText('apply-retrieval-config'))
      await user.click(screen.getByText('change-retrieval-mode'))

      expect(onMultipleRetrievalConfigChange).toHaveBeenCalledWith(expect.objectContaining({
        top_k: 8,
        score_threshold: 0.4,
        reranking_model: {
          provider: 'cohere',
          model: 'rerank-v3',
        },
        reranking_enable: true,
      }))
      expect(onRetrievalModeChange).toHaveBeenCalledWith(RETRIEVE_TYPE.oneWay)
    })
  })

  describe('Metadata controls', () => {
    it('should select metadata filter mode from the dropdown', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <MetadataFilterSelector
          value={MetadataFilteringModeEnum.disabled}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByRole('button', { name: /workflow.nodes.knowledgeRetrieval.metadata.options.disabled.title/i }))
      await user.click(screen.getByText('workflow.nodes.knowledgeRetrieval.metadata.options.manual.title'))

      expect(onSelect).toHaveBeenCalledWith(MetadataFilteringModeEnum.manual)
    })

    it('should remove stale metadata conditions and open the manual metadata panel', async () => {
      const user = userEvent.setup()
      const handleRemoveCondition = vi.fn()

      render(
        <MetadataTrigger
          selectedDatasetsLoaded
          metadataList={[createMetadata()]}
          metadataFilteringConditions={{
            logical_operator: LogicalOperator.and,
            conditions: [
              createCondition(),
              createCondition({
                id: 'condition-stale',
                metadata_id: 'missing',
                name: 'missing',
              }),
            ],
          }}
          handleAddCondition={vi.fn()}
          handleRemoveCondition={handleRemoveCondition}
          handleToggleConditionLogicalOperator={vi.fn()}
          handleUpdateCondition={vi.fn()}
        />,
      )

      expect(handleRemoveCondition).toHaveBeenCalledWith('condition-stale')

      await user.click(screen.getByRole('button', { name: /workflow.nodes.knowledgeRetrieval.metadata.panel.conditions/i }))

      expect(screen.getByText('metadata-panel')).toBeInTheDocument()
    })

    it('should call handleAddCondition with the correct metadata item when clicking any part of the row', async () => {
      const user = userEvent.setup()
      const handleAddCondition = vi.fn()
      const permissionMetadata = createMetadata({ id: 'meta-perm', name: 'permission', type: MetadataFilteringVariableType.string })
      const topicMetadata = createMetadata({ id: 'meta-topic', name: 'topic', type: MetadataFilteringVariableType.string })

      render(
        <AddCondition
          metadataList={[permissionMetadata, topicMetadata]}
          handleAddCondition={handleAddCondition}
        />,
      )

      await user.click(screen.getByRole('button', { name: /workflow.nodes.knowledgeRetrieval.metadata.panel.add/i }))
      await user.click(screen.getAllByText('string', { selector: 'div.shrink-0' })[0]!)

      expect(handleAddCondition).toHaveBeenCalledTimes(1)
      expect(handleAddCondition).toHaveBeenCalledWith(expect.objectContaining({
        id: 'meta-perm',
        name: 'permission',
      }))
    })

    it('should render automatic and manual metadata filter states', async () => {
      const user = userEvent.setup()
      const baseProps: MetadataShape = {
        metadataList: [createMetadata()],
        metadataFilteringConditions: {
          logical_operator: LogicalOperator.and,
          conditions: [createCondition()],
        },
        selectedDatasetsLoaded: true,
        handleAddCondition: vi.fn(),
        handleRemoveCondition: vi.fn(),
        handleToggleConditionLogicalOperator: vi.fn(),
        handleUpdateCondition: vi.fn(),
      }

      const { rerender } = render(
        <MetadataFilter
          {...baseProps}
          metadataFilterMode={MetadataFilteringModeEnum.automatic}
          handleMetadataFilterModeChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: /workflow.nodes.knowledgeRetrieval.metadata.options.automatic.title/i })).toBeInTheDocument()

      rerender(
        <MetadataFilter
          {...baseProps}
          metadataFilterMode={MetadataFilteringModeEnum.manual}
          handleMetadataFilterModeChange={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button', { name: /workflow.nodes.knowledgeRetrieval.metadata.panel.conditions/i }))

      expect(screen.getByText('metadata-panel')).toBeInTheDocument()
    })
  })

  describe('Condition inputs', () => {
    it('should toggle value method and keep the same option idempotent', async () => {
      const user = userEvent.setup()
      const onValueMethodChange = vi.fn()

      render(
        <ConditionValueMethod
          valueMethod="variable"
          onValueMethodChange={onValueMethodChange}
        />,
      )

      await user.click(screen.getByRole('button', { name: /variable/i }))
      await user.click(screen.getByText('Constant'))
      await user.click(screen.getByRole('button', { name: /variable/i }))
      await user.click(screen.getAllByText('Variable')[1]!)

      expect(onValueMethodChange).toHaveBeenCalledTimes(1)
      expect(onValueMethodChange).toHaveBeenCalledWith('constant')
    })

    it('should select workflow and common variables', async () => {
      const user = userEvent.setup()
      const onVariableChange = vi.fn()
      const onCommonVariableChange = vi.fn()

      const { rerender } = render(
        <ConditionVariableSelector
          onChange={onVariableChange}
          varType={VarType.string}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.knowledgeRetrieval.metadata.panel.select'))
      await user.click(screen.getByText('pick-var'))

      expect(onVariableChange).toHaveBeenCalledWith(['node-1', 'field'], { type: VarType.string })

      rerender(
        <ConditionCommonVariableSelector
          variables={[{ name: 'common', type: 'string', value: 'sys.user_name' }]}
          varType={VarType.string}
          onChange={onCommonVariableChange}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.knowledgeRetrieval.metadata.panel.select'))
      await user.click(screen.getByText('sys.user_name'))

      expect(onCommonVariableChange).toHaveBeenCalledWith('sys.user_name')
    })

    it('should update operator, clear date values, and remove conditions', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      const onDateChange = vi.fn()
      const onRemoveCondition = vi.fn()
      const onUpdateCondition = vi.fn()

      const { container } = render(
        <div>
          <ConditionOperator
            variableType={MetadataFilteringVariableType.string}
            value={MetadataComparisonOperator.contains}
            onSelect={onSelect}
          />
          <ConditionDate
            value={1710000000}
            onChange={onDateChange}
          />
          <ConditionItem
            metadataList={[createMetadata()]}
            condition={createCondition()}
            onRemoveCondition={onRemoveCondition}
            onUpdateCondition={onUpdateCondition}
          />
        </div>,
      )

      await user.click(screen.getAllByRole('button', { name: /contains/i })[0]!)
      await user.click(screen.getByText('workflow.nodes.ifElse.comparisonOperator.is'))
      await user.click(screen.getByText(/March 09 2024/).nextElementSibling as Element)
      fireEvent.change(screen.getByDisplayValue('agent'), { target: { value: 'updated-agent' } })
      fireEvent.click(container.querySelector('.ml-1.mt-1') as Element)

      expect(onSelect).toHaveBeenCalledWith(MetadataComparisonOperator.is as ComparisonOperator)
      expect(onDateChange).toHaveBeenCalledWith()
      expect(onUpdateCondition).toHaveBeenCalledWith('condition-1', expect.objectContaining({ value: 'updated-agent' }))
      expect(onRemoveCondition).toHaveBeenCalledWith('condition-1')
    })

    it('should resolve built-in metadata fields by name because their ids are shared', () => {
      render(
        <ConditionItem
          metadataList={[
            createMetadata({ id: 'built-in', name: 'document_name' }),
            createMetadata({ id: 'built-in', name: 'uploader' }),
          ]}
          condition={createCondition({
            metadata_id: 'built-in',
            name: 'uploader',
          })}
        />,
      )

      expect(screen.getByText('uploader')).toBeInTheDocument()
      expect(screen.queryByText('document_name')).not.toBeInTheDocument()
    })
  })

  describe('Node rendering', () => {
    it('should render selected datasets from the detail store and hide when none are selected', () => {
      const store = createDatasetsDetailStore()
      store.getState().updateDatasetsDetail([createDataset()])

      const renderNode = (datasetIds: string[]) => render(
        <DatasetsDetailContext.Provider value={store}>
          <Node
            id="knowledge-node"
            data={{
              type: BlockEnum.KnowledgeRetrieval,
              title: 'Knowledge Retrieval',
              desc: '',
              dataset_ids: datasetIds,
              query_variable_selector: [],
              query_attachment_selector: [],
              retrieval_mode: RETRIEVE_TYPE.multiWay,
            }}
          />
        </DatasetsDetailContext.Provider>,
      )

      const { rerender, container } = renderNode(['dataset-1'])

      expect(screen.getByText('Dataset Name')).toBeInTheDocument()

      rerender(
        <DatasetsDetailContext.Provider value={store}>
          <Node
            id="knowledge-node"
            data={{
              type: BlockEnum.KnowledgeRetrieval,
              title: 'Knowledge Retrieval',
              desc: '',
              dataset_ids: [],
              query_variable_selector: [],
              query_attachment_selector: [],
              retrieval_mode: RETRIEVE_TYPE.multiWay,
            }}
          />
        </DatasetsDetailContext.Provider>,
      )

      expect(container).toBeEmptyDOMElement()
    })
  })
})
