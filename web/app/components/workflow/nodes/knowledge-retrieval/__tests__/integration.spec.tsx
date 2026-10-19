import type {
  DatasetDetailWithPartialMembersResponse,
  DatasetDocMetadataResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import type { ComparisonOperator, MetadataFilteringCondition } from '../types'
import type { consoleClient } from '@/service/console'
import { zDatasetListResponse } from '@dify/contracts/api/console/datasets/zod.gen'
import { render as renderComponent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { updateDatasetSetting } from '@/service/datasets'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
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

function render(ui: ReactElement) {
  const { queryClient, wrapper: QueryWrapper } = createConsoleQueryWrapper()
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryKey(), {
    retrieval_method: [RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.fullText, RETRIEVE_METHOD.hybrid],
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
    accounts: [],
  })
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      provider: 'openai',
      models: [
        createCatalogModelFixture({
          model: 'text-embedding-3',
          model_type: ModelTypeEnum.textEmbedding,
        }),
        createCatalogModelFixture({
          model: 'rerank-old',
          label: { en_US: 'Legacy Reranker' },
          model_type: ModelTypeEnum.rerank,
        }),
        createCatalogModelFixture({
          model: 'rerank-v3',
          label: { en_US: 'Rerank V3' },
          model_type: ModelTypeEnum.rerank,
        }),
      ],
    }),
  ])
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryWrapper>
      <UrlState>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </UrlState>
    </QueryWrapper>
  )
  return renderComponent(ui, { wrapper })
}

const createDataset = (overrides: Partial<DatasetDetailWithPartialMembersResponse> = {}) =>
  createDatasetFixture({
    name: 'Dataset Name',
    provider: 'internal',
    maintainer: 'user-1',
    document_count: 1,
    embedding_model: 'text-embedding-3',
    permission_keys: [DatasetACLPermission.Edit, DatasetACLPermission.Use],
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

const createCondition = (
  overrides: Partial<MetadataFilteringCondition> = {},
): MetadataFilteringCondition => ({
  id: 'condition-1',
  name: 'topic',
  metadata_id: 'meta-1',
  comparison_operator: MetadataComparisonOperator.contains,
  value: 'agent',
  ...overrides,
})

const getDatasets = vi.hoisted(() => vi.fn<typeof consoleClient.datasets.get>())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'datasets.get': getDatasets }),
  }
})
vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  updateDatasetSetting: vi.fn(),
}))

describe('knowledge-retrieval path', () => {
  beforeEach(() => {
    getDatasets.mockReset().mockResolvedValue(
      zDatasetListResponse.parse({
        data: [createDataset({ id: 'dataset-2', name: 'Selected Dataset' })],
        has_more: false,
        limit: 20,
        page: 1,
        total: 1,
      }),
    )
    vi.mocked(updateDatasetSetting)
      .mockReset()
      .mockResolvedValue(createDataset({ name: 'Updated Dataset' }))
  })

  describe('Dataset controls', () => {
    it('should open dataset selector and forward selected datasets', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(<AddDataset selectedIds={['dataset-1']} onChange={onChange} />)

      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
        }),
      )
      await user.click(await screen.findByText('Selected Dataset'))
      await user.click(screen.getByRole('button', { name: 'common.operation.add' }))

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'dataset-1' }),
        expect.objectContaining({
          id: 'dataset-2',
          name: 'Selected Dataset',
        }),
      ])
    })

    it('should support editing a dataset item', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <DatasetItem
          payload={createDataset({ is_multimodal: true })}
          onChange={onChange}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.getByText('Dataset Name')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      expect(onChange).not.toHaveBeenCalled()
      const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
      await user.clear(name)
      await user.type(name, 'Updated Dataset')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated Dataset' }))
      })
      expect(updateDatasetSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetId: 'dataset-1',
          body: expect.objectContaining({ name: 'Updated Dataset' }),
        }),
      )
    })

    it('removes the selected dataset from the workflow list', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      const { rerender } = render(<DatasetList list={[]} onChange={onChange} />)

      expect(screen.getByText('appDebug.datasetConfig.knowledgeTip')).toBeInTheDocument()

      rerender(<DatasetList list={[createDataset()]} onChange={onChange} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))

      expect(onChange).toHaveBeenCalledWith([])
    })

    it('should hide dataset settings when ACL does not grant edit even if legacy dataset permission allows it', () => {
      const dataset = createDataset({
        permission: PermissionLevel.allTeamMembers,
        permission_keys: [DatasetACLPermission.Use],
      })

      render(<DatasetList list={[dataset]} onChange={vi.fn()} />)

      expect(
        screen.queryByRole('button', { name: 'common.operation.edit' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Retrieval settings', () => {
    it('migrates legacy retrieval mode and saves real model and limit selections', async () => {
      const user = userEvent.setup()
      const onRetrievalModeChange = vi.fn()
      const onMultipleRetrievalConfigChange = vi.fn()
      function EditableRetrieval() {
        const [payload, setPayload] = useState<ComponentProps<typeof RetrievalConfig>['payload']>({
          retrieval_mode: RETRIEVE_TYPE.oneWay,
          multiple_retrieval_config: {
            top_k: 3,
            score_threshold: null,
            reranking_model: { provider: 'openai', model: 'rerank-old' },
          },
        })
        const [open, setOpen] = useState(false)
        return (
          <RetrievalConfig
            payload={payload}
            onRetrievalModeChange={(mode) => {
              onRetrievalModeChange(mode)
              setPayload((value) => ({ ...value, retrieval_mode: mode }))
            }}
            onMultipleRetrievalConfigChange={(config) => {
              onMultipleRetrievalConfigChange(config)
              setPayload((value) => ({ ...value, multiple_retrieval_config: config }))
            }}
            rerankModalOpen={open}
            onRerankModelOpenChange={setOpen}
            selectedDatasets={[createDataset()]}
          />
        )
      }
      render(<EditableRetrieval />)
      await user.click(screen.getByRole('button', { name: 'dataset.retrievalSettings' }))
      await waitFor(() =>
        expect(onRetrievalModeChange).toHaveBeenCalledWith(RETRIEVE_TYPE.multiWay),
      )
      await user.click(screen.getByRole('button', { name: /Legacy Reranker/ }))
      await user.click(await screen.findByText('Rerank V3'))
      const topK = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
      await user.clear(topK)
      await user.type(topK, '8')
      await user.tab()
      await user.click(
        screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }),
      )
      const threshold = screen.getByRole('textbox', {
        name: 'appDebug.datasetConfig.score_threshold',
      })
      await user.clear(threshold)
      await user.type(threshold, '0.4')
      await user.tab()
      expect(onMultipleRetrievalConfigChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          top_k: 8,
          score_threshold: 0.4,
          reranking_model: { provider: 'openai', model: 'rerank-v3' },
        }),
      )
    })
  })

  describe('Metadata controls', () => {
    it('should select metadata filter mode from the dropdown', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <MetadataFilterSelector value={MetadataFilteringModeEnum.disabled} onSelect={onSelect} />,
      )

      await user.click(
        screen.getByRole('button', {
          name: /workflowModels.nodes.knowledgeRetrieval.metadata.options.disabled.title/i,
        }),
      )
      await user.click(
        screen.getByText('workflowModels.nodes.knowledgeRetrieval.metadata.options.manual.title'),
      )

      expect(onSelect.mock.calls[0]?.[0]).toBe(MetadataFilteringModeEnum.manual)
    })

    it('removes stale metadata conditions before showing the manual metadata panel', async () => {
      const user = userEvent.setup()
      const handleRemoveCondition = vi.fn()
      function EditableMetadata() {
        const [conditions, setConditions] = useState(() => [
          createCondition(),
          createCondition({
            id: 'condition-stale',
            metadata_id: 'missing',
            name: 'missing',
            value: 'stale-value',
          }),
        ])
        return (
          <MetadataTrigger
            selectedDatasetsLoaded
            metadataList={[createMetadata()]}
            metadataFilteringConditions={{ logical_operator: LogicalOperator.and, conditions }}
            handleAddCondition={vi.fn()}
            handleRemoveCondition={(id) => {
              handleRemoveCondition(id)
              setConditions((current) => current.filter((condition) => condition.id !== id))
            }}
            handleToggleConditionLogicalOperator={vi.fn()}
            handleUpdateCondition={vi.fn()}
          />
        )
      }
      render(<EditableMetadata />)
      expect(handleRemoveCondition).toHaveBeenCalledWith('condition-stale')
      await user.click(
        screen.getByRole('button', {
          name: /workflowModels.nodes.knowledgeRetrieval.metadata.panel.conditions/i,
        }),
      )
      expect(
        screen.getByText('workflowModels.nodes.knowledgeRetrieval.metadata.panel.title'),
      ).toBeInTheDocument()
      expect(screen.getByDisplayValue('agent')).toBeInTheDocument()
      expect(screen.queryByDisplayValue('stale-value')).not.toBeInTheDocument()
    })

    it('should call handleAddCondition with the chosen metadata item', async () => {
      const user = userEvent.setup()
      const handleAddCondition = vi.fn()
      const permissionMetadata = createMetadata({
        id: 'meta-perm',
        name: 'permission',
        type: MetadataFilteringVariableType.string,
      })
      const topicMetadata = createMetadata({
        id: 'meta-topic',
        name: 'topic',
        type: MetadataFilteringVariableType.string,
      })

      render(
        <AddCondition
          metadataList={[permissionMetadata, topicMetadata]}
          handleAddCondition={handleAddCondition}
        />,
      )

      await user.click(
        screen.getByRole('button', {
          name: /workflowModels.nodes.knowledgeRetrieval.metadata.panel.add/i,
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: /^permission/ }))

      expect(handleAddCondition).toHaveBeenCalledTimes(1)
      expect(handleAddCondition).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'meta-perm',
          name: 'permission',
        }),
      )
    })
  })

  describe('Condition inputs', () => {
    it('should toggle value method and keep the same option idempotent', async () => {
      const user = userEvent.setup()
      const onValueMethodChange = vi.fn()

      render(
        <ConditionValueMethod valueMethod="variable" onValueMethodChange={onValueMethodChange} />,
      )

      await user.click(screen.getByRole('button', { name: /variable/i }))
      const choices = within(screen.getByRole('dialog'))
      await user.click(choices.getByText('Variable'))
      expect(onValueMethodChange).not.toHaveBeenCalled()
      await user.click(choices.getByText('Constant'))

      expect(onValueMethodChange).toHaveBeenCalledTimes(1)
      expect(onValueMethodChange).toHaveBeenCalledWith('constant')
    })

    it('should select workflow and common variables', async () => {
      const user = userEvent.setup()
      const onVariableChange = vi.fn()
      const onCommonVariableChange = vi.fn()

      function EditableVariable() {
        const [valueSelector, setValueSelector] = useState<string[]>([])
        return (
          <ConditionVariableSelector
            valueSelector={valueSelector}
            onChange={(selector, variable) => {
              onVariableChange(selector, variable)
              setValueSelector(selector)
            }}
            varType={VarType.string}
            availableNodes={[createNode({ id: 'node-1', data: { title: 'Source' } })]}
            nodesOutputVars={[
              {
                nodeId: 'node-1',
                title: 'Source',
                vars: [{ variable: 'field', type: VarType.string }],
              },
            ]}
          />
        )
      }
      const { rerender } = render(<EditableVariable />)

      await user.click(
        screen.getByText('workflowModels.nodes.knowledgeRetrieval.metadata.panel.select'),
      )
      await user.click(within(screen.getByRole('dialog')).getByText('field'))

      expect(onVariableChange).toHaveBeenCalledWith(
        ['node-1', 'field'],
        expect.objectContaining({ type: VarType.string, variable: 'field' }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByText('field')).toBeInTheDocument()

      rerender(
        <ConditionCommonVariableSelector
          variables={[{ name: 'common', type: 'string', value: 'sys.user_name' }]}
          varType={VarType.string}
          onChange={onCommonVariableChange}
        />,
      )

      await user.click(
        screen.getByText('workflowModels.nodes.knowledgeRetrieval.metadata.panel.select'),
      )
      await user.click(screen.getByText('sys.user_name'))

      expect(onCommonVariableChange).toHaveBeenCalledWith('sys.user_name')
    })

    it('should update operator, clear date values, and remove conditions', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      const onDateChange = vi.fn()
      const onRemoveCondition = vi.fn()
      const onUpdateCondition = vi.fn()
      function EditableCondition() {
        const [condition, setCondition] = useState(() => createCondition())
        return (
          <ConditionItem
            metadataList={[createMetadata()]}
            condition={condition}
            onRemoveCondition={onRemoveCondition}
            onUpdateCondition={(id, next) => {
              onUpdateCondition(id, next)
              setCondition(next)
            }}
          />
        )
      }

      render(
        <div>
          <ConditionOperator
            variableType={MetadataFilteringVariableType.string}
            value={MetadataComparisonOperator.contains}
            onSelect={onSelect}
          />
          <ConditionDate value={1710000000} onChange={onDateChange} />
          <EditableCondition />
        </div>,
      )

      await user.click(screen.getAllByRole('button', { name: /contains/i })[0]!)
      await user.click(screen.getByText('workflowLogic.nodes.ifElse.comparisonOperator.is'))
      await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
      await user.clear(screen.getByDisplayValue('agent'))
      await user.type(screen.getByRole('textbox'), 'updated-agent')
      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))

      expect(onSelect).toHaveBeenCalledWith(MetadataComparisonOperator.is as ComparisonOperator)
      expect(onDateChange).toHaveBeenCalledWith(undefined)
      expect(onUpdateCondition).toHaveBeenCalledWith(
        'condition-1',
        expect.objectContaining({ value: 'updated-agent' }),
      )
      expect(onRemoveCondition).toHaveBeenCalledWith('condition-1')
    })

    it.each([
      [MetadataFilteringVariableType.string, 'agent'],
      [MetadataFilteringVariableType.number, 42],
    ])('prevents editing or deleting disabled %s conditions', async (type, value) => {
      const user = userEvent.setup()
      const onUpdateCondition = vi.fn()
      const onRemoveCondition = vi.fn()
      render(
        <ConditionItem
          disabled
          metadataList={[createMetadata({ type })]}
          condition={createCondition({ value })}
          onUpdateCondition={onUpdateCondition}
          onRemoveCondition={onRemoveCondition}
        />,
      )
      const input = screen.getByRole('textbox', {
        name: 'workflowModels.nodes.knowledgeRetrieval.metadata.panel.placeholder',
      })
      expect(input).toHaveValue(String(value))
      expect(input).toBeDisabled()
      await user.type(input, '123')
      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      expect(onUpdateCondition).not.toHaveBeenCalled()
      expect(onRemoveCondition).not.toHaveBeenCalled()
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

      const renderNode = (datasetIds: string[]) =>
        render(
          <DatasetsDetailContext value={store}>
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
          </DatasetsDetailContext>,
        )

      const { rerender, container } = renderNode(['dataset-1'])

      expect(screen.getByText('Dataset Name')).toBeInTheDocument()

      rerender(
        <DatasetsDetailContext value={store}>
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
        </DatasetsDetailContext>,
      )

      expect(container).toBeEmptyDOMElement()
    })
  })
})
