import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { DatasetConfigs } from '@/models/debug'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useRef, useState } from 'react'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import DebugConfigurationContext from '@/context/debug-configuration'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { updateDatasetSetting } from '@/service/datasets'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import {
  createDatasetConfigsFixture,
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetConfig from '../index'

vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  updateDatasetSetting: vi.fn().mockResolvedValue({}),
}))

type Configuration = ReturnType<typeof createDebugConfigurationFixture>
const metadataKey = 'workflowModels.nodes.knowledgeRetrieval.metadata'
const createDataset = (overrides: Partial<DatasetDetailWithPartialMembersResponse> = {}) =>
  createDatasetFixture({
    id: 'dataset-1',
    name: 'Test Dataset',
    permission_keys: [DatasetACLPermission.Edit, DatasetACLPermission.Use],
    maintainer: 'user-123',
    indexing_technique: 'high_quality',
    embedding_available: true,
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    doc_metadata: [
      { id: 'category', name: 'category', type: 'string' },
      { id: 'priority', name: 'priority', type: 'number' },
    ],
    retrieval_model_dict: {
      search_method: 'semantic_search',
      reranking_enable: false,
      reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
      top_k: 4,
      score_threshold_enabled: false,
      score_threshold: 0.7,
    },
    ...overrides,
  })

function renderDatasetConfig(overrides: Partial<Configuration> = {}) {
  const initial = createDebugConfigurationFixture({
    datasetConfigs: createDatasetConfigsFixture({
      metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
    }),
    ...overrides,
  })
  const { wrapper: QueryProvider, queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-123' },
    workspacePermissionKeys: [],
  })
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
    accounts: [],
  })
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryKey(), {
    retrieval_method: ['semantic_search', 'full_text_search', 'hybrid_search'],
  })
  const { wrapper: UrlProvider } = createNuqsTestWrapper()
  function ControlledConfiguration() {
    const [dataSets, setDataSets] = useState(initial.dataSets)
    const [modelConfig, setModelConfig] = useState(initial.modelConfig)
    const [datasetConfigs, setDatasetConfigs] = useState(initial.datasetConfigs)
    const datasetConfigsRef = useRef(datasetConfigs)
    const handleDatasetConfigsChange = useCallback((next: DatasetConfigs) => {
      datasetConfigsRef.current = next
      setDatasetConfigs(next)
    }, [])
    const [rerankSettingModalOpen, setRerankSettingModalOpen] = useState(false)
    return (
      <DebugConfigurationContext.Provider
        value={{
          ...initial,
          dataSets,
          setDataSets,
          modelConfig,
          setModelConfig,
          datasetConfigs,
          datasetConfigsRef,
          setDatasetConfigs: handleDatasetConfigsChange,
          rerankSettingModalOpen,
          setRerankSettingModalOpen,
        }}
      >
        <DatasetConfig />
        <output aria-label="Saved configuration">
          {JSON.stringify({ dataSets, modelConfig, datasetConfigs })}
        </output>
      </DebugConfigurationContext.Provider>
    )
  }
  return {
    queryClient,
    ...render(
      <QueryProvider>
        <UrlProvider>
          <EventEmitterContextProvider>
            <ControlledConfiguration />
          </EventEmitterContextProvider>
        </UrlProvider>
      </QueryProvider>,
    ),
  }
}

const savedConfiguration = (): Pick<Configuration, 'dataSets' | 'datasetConfigs' | 'modelConfig'> =>
  JSON.parse(screen.getByLabelText('Saved configuration').textContent!)
const manualConfig = () =>
  createDatasetConfigsFixture({ metadata_filtering_mode: MetadataFilteringModeEnum.manual })
const openConditions = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen.getByRole('button', { name: new RegExp(`${metadataKey}.panel.conditions`) }),
  )
}
const addCondition = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole('button', { name: `${metadataKey}.panel.add` }))
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(name) }))
}

describe('DatasetConfig', () => {
  it('shows the empty state and disables retrieval settings without datasets', () => {
    renderDatasetConfig({ mode: 'completion' })
    expect(screen.getByText('appDebug.feature.dataSet.noData')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.retrievalSettings' })).toBeDisabled()
    expect(
      screen.queryByText('appDebug.feature.dataSet.queryVariable.title'),
    ).not.toBeInTheDocument()
  })

  it('renders selected knowledge with retrieval settings but no chat context selector', () => {
    renderDatasetConfig({ dataSets: [createDataset()] })
    expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.retrievalSettings' })).toBeEnabled()
    expect(
      screen.queryByText('appDebug.feature.dataSet.queryVariable.title'),
    ).not.toBeInTheDocument()
  })

  it('hides retrieval settings in agent mode', () => {
    renderDatasetConfig({ isAgent: true })
    expect(
      screen.queryByRole('button', { name: 'dataset.retrievalSettings' }),
    ).not.toBeInTheDocument()
  })

  it('requests the caller-owned knowledge selection surface', async () => {
    const user = userEvent.setup()
    const showSelectDataSet = vi.fn()
    renderDatasetConfig({ showSelectDataSet })
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(showSelectDataSet).toHaveBeenCalledOnce()
  })

  it('removes only the selected knowledge and reaches the empty state after removing the last one', async () => {
    const user = userEvent.setup()
    const remaining = createDataset({ id: 'dataset-2', name: 'Second Dataset' })
    renderDatasetConfig({ dataSets: [createDataset(), remaining] })
    await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[0]!)
    expect(screen.queryByText('Test Dataset')).not.toBeInTheDocument()
    expect(screen.getByText('Second Dataset')).toBeInTheDocument()
    expect(savedConfiguration().dataSets).toEqual([remaining])
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(screen.getByText('appDebug.feature.dataSet.noData')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.retrievalSettings' })).toBeDisabled()
  })

  it('opens retrieval settings when removal leaves only external knowledge', async () => {
    const user = userEvent.setup()
    renderDatasetConfig({
      dataSets: [
        createDataset(),
        createDataset({ id: 'external', name: 'External knowledge', provider: 'external' }),
      ],
    })
    await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[0]!)
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('button', { name: 'common.operation.save' }),
    ).toBeInTheDocument()
    expect(savedConfiguration().dataSets.map((dataset) => dataset.id)).toEqual(['external'])
  })

  it('edits the real knowledge settings form and keeps the saved dataset identity', async () => {
    const user = userEvent.setup()
    renderDatasetConfig({ dataSets: [createDataset()] })
    const edit = screen.getByRole('button', { name: 'common.operation.edit' })
    edit.focus()
    await user.click(edit)
    const name = await screen.findByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(name)
    await user.type(name, 'Updated dataset')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'datasetSettings.form.name' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Updated dataset')).toBeInTheDocument()
    expect(savedConfiguration().dataSets).toEqual([
      expect.objectContaining({ id: 'dataset-1', name: 'Updated dataset' }),
    ])
    expect(updateDatasetSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: 'dataset-1',
        body: expect.objectContaining({ name: 'Updated dataset' }),
      }),
    )
  })

  it('respects edit ACL even when the legacy permission allows all members', () => {
    renderDatasetConfig({
      dataSets: [
        createDataset({
          permission: PermissionLevel.allTeamMembers,
          maintainer: 'other-user',
          permission_keys: [DatasetACLPermission.Use],
        }),
      ],
    })
    expect(screen.getByText('Test Dataset')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  })

  it('switches the context variable without changing the other prompt configuration', async () => {
    const user = userEvent.setup()
    renderDatasetConfig({
      mode: 'completion',
      dataSets: [createDataset()],
      modelConfig: createModelConfigFixture({
        configs: {
          prompt_template: 'Answer the query',
          prompt_variables: [
            { key: 'query', name: 'Query', type: 'string', is_context_var: false },
            { key: 'context', name: 'Context', type: 'string', is_context_var: true },
          ],
        },
      }),
    })
    await user.click(screen.getByRole('button', { name: /context/ }))
    await user.click(await screen.findByText('query'))
    expect(screen.getByRole('button', { name: '{{ query }}' })).toBeInTheDocument()
    expect(savedConfiguration().modelConfig.configs).toEqual({
      prompt_template: 'Answer the query',
      prompt_variables: [
        { key: 'query', name: 'Query', type: 'string', is_context_var: true },
        { key: 'context', name: 'Context', type: 'string', is_context_var: false },
      ],
    })
  })

  it('switches metadata filtering to automatic and exposes its model controls', async () => {
    const user = userEvent.setup()
    renderDatasetConfig({ dataSets: [createDataset()] })
    await user.click(screen.getByRole('button', { name: `${metadataKey}.options.disabled.title` }))
    await user.click(
      await screen.findByRole('menuitemradio', {
        name: new RegExp(`${metadataKey}.options.automatic.title`),
      }),
    )
    expect(screen.getByText(`${metadataKey}.options.automatic.desc`)).toBeInTheDocument()
    expect(savedConfiguration().datasetConfigs.metadata_filtering_mode).toBe(
      MetadataFilteringModeEnum.automatic,
    )
  })

  it('adds, edits, combines and removes real metadata conditions without losing prior edits', async () => {
    const user = userEvent.setup()
    renderDatasetConfig({ dataSets: [createDataset()], datasetConfigs: manualConfig() })
    await openConditions(user)
    await addCondition(user, 'category')
    const category = screen.getByRole('group', { name: 'category' })
    await user.type(within(category).getByRole('textbox'), 'research')
    expect(savedConfiguration().datasetConfigs.metadata_filtering_conditions).toEqual({
      logical_operator: LogicalOperator.and,
      conditions: [
        expect.objectContaining({
          metadata_id: 'category',
          name: 'category',
          comparison_operator: ComparisonOperator.is,
          value: 'research',
        }),
      ],
    })
    await addCondition(user, 'priority')
    expect(screen.getByRole('group', { name: 'priority' })).toBeInTheDocument()
    expect(savedConfiguration().datasetConfigs.metadata_filtering_conditions?.conditions).toEqual([
      expect.objectContaining({ name: 'category', value: 'research' }),
      expect.objectContaining({
        metadata_id: 'priority',
        name: 'priority',
        comparison_operator: ComparisonOperator.equal,
      }),
    ])
    await user.click(screen.getByText('AND'))
    expect(screen.getByText('OR')).toBeInTheDocument()
    expect(
      savedConfiguration().datasetConfigs.metadata_filtering_conditions?.logical_operator,
    ).toBe(LogicalOperator.or)
    await user.click(within(category).getByRole('button', { name: 'common.operation.remove' }))
    expect(screen.queryByRole('group', { name: 'category' })).not.toBeInTheDocument()
    expect(savedConfiguration().datasetConfigs.metadata_filtering_conditions?.conditions).toEqual([
      expect.objectContaining({ name: 'priority' }),
    ])
  })

  it('offers no metadata conditions when the dataset has no fields', async () => {
    const user = userEvent.setup()
    renderDatasetConfig({
      dataSets: [createDataset({ doc_metadata: [] })],
      datasetConfigs: manualConfig(),
    })
    await openConditions(user)
    await user.click(screen.getByRole('button', { name: `${metadataKey}.panel.add` }))
    expect(await screen.findByText('common.noData')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('offers only metadata shared by every selected dataset', async () => {
    const user = userEvent.setup()
    renderDatasetConfig({
      dataSets: [
        createDataset(),
        createDataset({
          id: 'dataset-2',
          name: 'Second Dataset',
          doc_metadata: [
            { id: 'category', name: 'category', type: 'string' },
            { id: 'tags', name: 'tags', type: 'string' },
          ],
        }),
      ],
      datasetConfigs: manualConfig(),
    })
    await openConditions(user)
    await user.click(screen.getByRole('button', { name: `${metadataKey}.panel.add` }))
    expect(await screen.findByRole('menuitem', { name: /category/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /priority|tags/ })).not.toBeInTheDocument()
  })
})
