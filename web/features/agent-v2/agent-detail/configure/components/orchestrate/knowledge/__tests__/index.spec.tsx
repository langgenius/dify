import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { zKnowledgeFsSpaceListResponse } from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { ORPCError } from '@orpc/client'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import {
  agentSoulConfigToFormState,
  formStateToAgentSoulConfig,
} from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedKnowledgeFsFeatures,
} from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { RETRIEVE_TYPE } from '@/types/app'
import {
  AgentOrchestrateReadOnlyContext,
  AgentOrchestrateViewingVersionContext,
} from '../../read-only-context'
import { AgentKnowledgeRetrieval } from '../index'

const render = createNuqsTestRenderer(renderWithConsoleQuery)

const { getDatasets, getDataset, getSpaces, getRules } = vi.hoisted(() => ({
  getDatasets: vi.fn(),
  getDataset: vi.fn(),
  getSpaces: vi.fn(),
  getRules: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.get': getDatasets,
      'datasets.byDatasetId.get': getDataset,
      'knowledgeFs.spaces.get': getSpaces,
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': getRules,
      'workspaces.current.models.modelTypes.byModelType.get': async () => ({ data: [] }),
      'workspaces.current.defaultModel.get': async () => ({ data: null }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': getRules,
    }),
  }
})
vi.mock('@/context/i18n', () => ({
  useDocLink: () => () => 'https://docs.example.com',
  useGetLanguage: () => 'en_US',
}))
beforeEach(() => {
  getRules.mockReset().mockResolvedValue({
    data: [
      {
        name: 'temperature',
        label: { en_US: 'Temperature' },
        type: 'float',
        default: 0.7,
        min: 0,
        max: 2,
        required: false,
        options: [],
      },
    ],
  })
  getDataset
    .mockReset()
    .mockImplementation(async ({ params }: { params: { dataset_id: string } }) =>
      createDatasetFixture({ id: params.dataset_id }),
    )
  getSpaces.mockReset().mockResolvedValue({ data: [], page: 1, limit: 50, has_more: false })
  getDatasets.mockReset().mockResolvedValue({
    data: [],
    page: 1,
    limit: 100,
    total: 1,
    has_more: false,
  })
})

const SPACE = '00000000-0000-4000-8000-000000000001'
const SECOND = '00000000-0000-4000-8000-000000000002'
const space = (
  id = SPACE,
  name = 'Product manual',
  available = true,
): KnowledgeFsSpaceListItemResponse => ({
  control_space_id: id,
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:00:00Z',
  knowledge_space_id: id,
  linked_apps: 0,
  owner_account_id: 'account',
  permission_keys: [
    'knowledge_space_read',
    'knowledge_space_query',
    'knowledge_space_access_config',
  ],
  resource_version: 1,
  state: 'active',
  technical_status: available ? 'available' : 'unavailable',
  visibility: 'only_me',
  technical_summary: {
    knowledge_space_id: id,
    name,
    description: 'A real knowledge space',
    revision: 1,
    slug: id,
  },
})
const binding = { id: 'docs', controlSpaceId: SPACE, name: 'Product manual' }

function Snapshot({ label = 'snapshot' }: { label?: string }) {
  const draft = useAtomValue(agentComposerDraftAtom)
  return (
    <output aria-label={label}>
      {JSON.stringify({
        prompt: draft.prompt,
        knowledge: formStateToAgentSoulConfig({ formState: draft }).knowledge,
      })}
    </output>
  )
}

function setup(
  bindings: AgentKnowledgeRetrievalItem[] = [],
  {
    enabled = true,
    viewingVersion = false,
    readOnly = false,
    label = 'snapshot',
    spaces = [space(), space(SECOND, 'Engineering')],
    hasMore = false,
  } = {},
) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  const options = consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
    input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: () => undefined,
  })
  queryClient.setQueryData(options.queryKey, {
    pages: [
      zKnowledgeFsSpaceListResponse.parse({ data: spaces, page: 1, limit: 50, has_more: hasMore }),
    ],
    pageParams: [1],
  })
  return render(
    <AgentComposerProvider
      initialDraft={{
        ...defaultAgentSoulConfigFormState,
        prompt: '[§knowledge:docs:Product manual§]',
        knowledgeRetrievals: bindings,
      }}
    >
      <AgentOrchestrateViewingVersionContext value={viewingVersion}>
        <AgentOrchestrateReadOnlyContext value={readOnly}>
          <AgentKnowledgeRetrieval />
        </AgentOrchestrateReadOnlyContext>
      </AgentOrchestrateViewingVersionContext>
      <Snapshot label={label} />
    </AgentComposerProvider>,
    { queryClient, knowledgeFsFeatures: { agent_enabled: enabled } },
  )
}
function setupClassic(item: AgentKnowledgeRetrievalItem) {
  return setup([item], { enabled: false })
}

const snapshot = () => JSON.parse(screen.getByLabelText('snapshot').textContent ?? '{}')
const optionName = (name: string) => new RegExp(`^${name}(?: |$)`)
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /knowledgeRetrieval.add/ }))
  return screen.findByRole('dialog')
}

const datasetPage = (data = [createDatasetFixture()]) => ({
  data,
  page: 1,
  limit: 50,
  total: data.length,
  has_more: false,
})
async function advanced(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('button', { name: /advancedSettings.label/ }))
}

async function openDatasetPicker(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(
    await within(dialog).findByRole('button', {
      name: /operation.add.*nodes.knowledgeRetrieval.knowledge/,
    }),
  )
  return screen.findByRole('dialog', { name: /feature.dataSet.selectTitle/ })
}

async function confirmDatasetPicker(user: ReturnType<typeof userEvent.setup>, picker: HTMLElement) {
  await user.click(within(picker).getByRole('button', { name: 'common.operation.add' }))
  await waitFor(() => expect(picker).not.toBeInTheDocument())
}

async function toggleDatasets(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  names: RegExp[],
) {
  const picker = await openDatasetPicker(user, dialog)
  for (const name of names) await user.click(await within(picker).findByRole('button', { name }))
  await confirmDatasetPicker(user, picker)
}

describe('shared knowledge binding dialog', () => {
  beforeEach(() => getDatasets.mockResolvedValue(datasetPage()))

  it.each([false, true])(
    'selects Classic knowledge and commits only on confirmation (KnowledgeFS=%s)',
    async (enabled) => {
      const user = userEvent.setup()
      setup([binding], { enabled })
      const dialog = await open(user)
      await user.click(
        await within(dialog).findByRole('option', { name: optionName('Test Dataset') }),
      )
      expect(snapshot().knowledge.sets).toEqual([])
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      expect(snapshot().knowledge.sets[0]).toMatchObject({
        name: 'Test Dataset',
        datasets: [{ id: 'dataset-1' }],
        query: { mode: 'generated_query' },
      })
      expect(snapshot().knowledge.spaces[0]).toMatchObject({ id: binding.id })
      expect(screen.getAllByRole('heading')).toHaveLength(1)
      if (!enabled) {
        expect(screen.queryByText('Product manual')).not.toBeInTheDocument()
        expect(getSpaces).not.toHaveBeenCalled()
      }
    },
  )

  it('discards Classic selections and advanced edits on cancel', async () => {
    const user = userEvent.setup()
    setupClassic({ id: 'classic', name: 'Saved search', datasetRefs: [{ id: 'dataset-1' }] })
    let dialog = await open(user)
    await advanced(user, dialog)
    const name = within(dialog).getByRole('textbox', { name: /dialog.nameLabel/ })
    await user.clear(name)
    await user.type(name, 'Unsaved')
    await user.click(within(dialog).getByRole('button', { name: /operation.cancel/ }))
    expect(snapshot().knowledge.sets[0].name).toBe('Saved search')
    dialog = await open(user)
    expect(
      within(dialog).getByRole('option', { name: optionName('Saved search') }),
    ).toHaveAttribute('aria-selected', 'true')
    await user.click(within(dialog).getByRole('option', { name: optionName('Saved search') }))
    await user.click(within(dialog).getByRole('button', { name: /operation.cancel/ }))
    expect(snapshot().knowledge.sets).toHaveLength(1)
  })

  it('preserves existing dataset groups, retrieval settings and stable prompt references', async () => {
    const user = userEvent.setup()
    setupClassic({
      id: 'docs',
      name: 'Product manual',
      datasetRefs: [{ id: 'dataset-1' }, { id: 'dataset-2' }],
      queryMode: 'custom',
      customQuery: 'original question',
      metadataFilterMode: MetadataFilteringModeEnum.manual,
      metadataFilteringConditions: {
        logical_operator: LogicalOperator.and,
        conditions: [
          {
            id: 'condition',
            name: 'author',
            comparison_operator: ComparisonOperator.is,
            value: 'Ada',
          },
        ],
      },
      multipleRetrievalConfig: { top_k: 7, score_threshold: 0.4, reranking_enable: false },
    })
    const original = snapshot().knowledge.sets[0]
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('option', { name: optionName('Product manual') }))
    await user.click(within(dialog).getByRole('option', { name: optionName('Product manual') }))
    await advanced(user, dialog)
    expect(await within(dialog).findByRole('textbox', { name: /customInputLabel/ })).toHaveValue(
      'original question',
    )
    await user.click(
      within(dialog).getByRole('button', {
        name: /operation.add.*nodes.knowledgeRetrieval.knowledge/,
      }),
    )
    const unchangedPicker = await screen.findByRole('dialog', {
      name: /feature.dataSet.selectTitle/,
    })
    await user.click(within(unchangedPicker).getByRole('button', { name: 'common.operation.add' }))
    await waitFor(() => expect(unchangedPicker).not.toBeInTheDocument())
    const name = within(dialog).getByRole('textbox', { name: /dialog.nameLabel/ })
    await user.clear(name)
    await user.type(name, 'Renamed search')
    expect(snapshot().knowledge.sets[0]).toEqual(original)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets).toEqual([{ ...original, name: 'Renamed search' }])
    expect(snapshot().prompt).toContain('Renamed search')
  })

  it('keeps all KnowledgeFS UI and requests hidden while preserving disabled bindings', async () => {
    const user = userEvent.setup()
    const { queryClient } = setupClassic({ ...binding, isMissing: true })
    queryClient.removeQueries({ queryKey: consoleQuery.knowledgeFs.spaces.get.queryKey() })
    const dialog = await open(user)
    await user.click(
      await within(dialog).findByRole('option', { name: optionName('Test Dataset') }),
    )
    await advanced(user, dialog)
    expect(dialog.textContent).not.toMatch(/knowledgeFs|view.classic/)
    expect(within(dialog).queryByText('Product manual')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets).toHaveLength(1)
    expect(snapshot().knowledge.spaces[0]).toMatchObject({ id: 'docs', is_missing: true })
    expect(getSpaces).not.toHaveBeenCalled()
  })

  it('validates Classic advanced settings and applies both sources together', async () => {
    const user = userEvent.setup()
    setup()
    const dialog = await open(user)
    await user.click(
      await within(dialog).findByRole('option', { name: optionName('Test Dataset') }),
    )
    await user.click(within(dialog).getByRole('option', { name: optionName('Product manual') }))
    await advanced(user, dialog)
    await user.click(within(dialog).getByRole('radio', { name: /dialog.query.custom$/ }))
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(within(dialog).getAllByRole('alert').length).toBeGreaterThan(0)
    expect(snapshot().knowledge).toEqual({ sets: [], spaces: [] })
    await user.type(
      within(dialog).getByRole('textbox', { name: /customInputLabel/ }),
      'support question',
    )
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets[0].query).toEqual({
      mode: 'user_query',
      value: 'support question',
    })
    expect(snapshot().knowledge.spaces).toHaveLength(1)
  })

  it('preserves single retrieval and its model when settings are only inspected', async () => {
    const user = userEvent.setup()
    setupClassic({
      id: 'classic',
      name: 'Saved search',
      selectedDatasets: [createDatasetFixture()],
      retrievalMode: RETRIEVE_TYPE.oneWay,
      singleRetrievalConfig: {
        model: {
          provider: 'openai',
          name: 'gpt-4o',
          mode: 'chat',
          completion_params: { temperature: 0.2 },
        },
      },
    })
    const original = snapshot().knowledge
    const dialog = await open(user)
    await advanced(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'dataset.retrievalSettings' }))
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge).toEqual(original)
  })

  it('rejects names used by hidden bindings without validating their unavailable state', async () => {
    const user = userEvent.setup()
    setup(
      [
        { ...binding, isMissing: true },
        { id: 'classic', name: 'Saved search', selectedDatasets: [createDatasetFixture()] },
      ],
      { enabled: false },
    )
    const original = snapshot().knowledge
    const dialog = await open(user)
    await advanced(user, dialog)
    const name = within(dialog).getByRole('textbox', { name: /dialog.nameLabel/ })
    await user.clear(name)
    await user.type(name, '  pRoDuCt MaNuAl  ')
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(dialog).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription(/keyAlreadyExists/)
    expect(snapshot().knowledge).toEqual(original)
    expect(dialog.textContent).not.toMatch(/knowledgeFs/)
    await user.clear(name)
    await user.type(name, 'Distinct search')
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets[0].name).toBe('Distinct search')
    expect(snapshot().knowledge.spaces).toEqual(original.spaces)
    expect(getSpaces).not.toHaveBeenCalled()
  })

  it('stages changes to an existing dataset group until shared confirmation', async () => {
    const user = userEvent.setup()
    const first = createDatasetFixture()
    const second = createDatasetFixture({ id: 'dataset-2', name: 'Second dataset' })
    getDatasets.mockResolvedValue(datasetPage([first, second]))
    setupClassic({ id: 'group', name: 'Saved group', selectedDatasets: [first] })
    const dialog = await open(user)
    await advanced(user, dialog)
    await toggleDatasets(user, dialog, [/Second dataset/])
    expect(snapshot().knowledge.sets[0].datasets).toHaveLength(1)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets).toHaveLength(1)
    expect(snapshot().knowledge.sets[0]).toMatchObject({
      id: 'group',
      name: 'Saved group',
      datasets: [{ id: first.id }, { id: second.id }],
    })
  })

  it('edits and removes imported metadata conditions independently when their row IDs are missing', async () => {
    const user = userEvent.setup()
    getDataset.mockResolvedValue(
      createDatasetFixture({
        doc_metadata: ['topic', 'author', 'language'].map((name) => ({
          id: name,
          name,
          type: 'string',
        })),
      }),
    )
    const config = formStateToAgentSoulConfig({
      formState: {
        ...defaultAgentSoulConfigFormState,
        knowledgeRetrievals: [
          { id: 'classic', name: 'Imported search', datasetRefs: [{ id: 'dataset-1' }] },
        ],
      },
    })
    config.knowledge!.sets![0]!.metadata_filtering = {
      mode: 'manual',
      conditions: {
        logical_operator: 'and',
        conditions: [
          { name: 'topic', comparison_operator: 'is', value: 'agents' },
          { name: 'author', comparison_operator: 'is', value: 'Ada' },
          { id: 'existing-id', name: 'language', comparison_operator: 'is', value: 'en' },
        ],
      },
    }
    setup(agentSoulConfigToFormState(config).knowledgeRetrievals, { enabled: false })
    let dialog = await open(user)
    await advanced(user, dialog)
    const conditionsButton = await within(dialog).findByRole('button', {
      name: /metadata.panel.conditions/,
    })
    await user.click(conditionsButton)
    const author = within(screen.getByRole('group', { name: 'author' }))
    await user.clear(author.getByRole('textbox'))
    await user.type(author.getByRole('textbox'), 'Grace')
    expect(within(screen.getByRole('group', { name: 'topic' })).getByRole('textbox')).toHaveValue(
      'agents',
    )
    await user.click(
      within(screen.getByRole('group', { name: 'topic' })).getByRole('button', {
        name: 'common.operation.remove',
      }),
    )
    expect(screen.getByRole('group', { name: 'author' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'topic' })).not.toBeInTheDocument()
    await user.click(conditionsButton)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    const saved = snapshot().knowledge.sets[0].metadata_filtering.conditions.conditions
    expect(saved).toEqual([
      expect.objectContaining({ id: expect.any(String), name: 'author', value: 'Grace' }),
      expect.objectContaining({ id: 'existing-id', name: 'language', value: 'en' }),
    ])
    expect(saved[0].id).not.toBe(saved[1].id)
    dialog = await open(user)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets[0].metadata_filtering.conditions.conditions).toEqual(saved)
  })

  it('blocks a mixed-index group without a required reranker and allows correcting the dataset selection', async () => {
    const user = userEvent.setup()
    const first = createDatasetFixture()
    const second = createDatasetFixture({
      id: 'dataset-2',
      name: 'Economy docs',
      indexing_technique: 'economy',
    })
    getDatasets.mockResolvedValue(datasetPage([first, second]))
    setupClassic({ id: 'group', name: 'Saved group', selectedDatasets: [first] })
    const original = snapshot().knowledge
    const dialog = await open(user)
    await advanced(user, dialog)
    await toggleDatasets(user, dialog, [/Economy docs/])
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getAllByRole('alert')[0]?.textContent).toMatch(/rerankModel/)
    expect(snapshot().knowledge).toEqual(original)
    await toggleDatasets(user, dialog, [/Economy docs/])
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(snapshot().knowledge.sets[0]).toMatchObject({
      datasets: [{ id: first.id }],
      retrieval: { reranking_mode: 'weighted_score', reranking_enable: true },
    })
  })

  it('requires a reranker when same-name embedding models come from different providers', async () => {
    const user = userEvent.setup()
    const first = createDatasetFixture()
    const second = createDatasetFixture({
      id: 'dataset-2',
      name: 'Azure docs',
      embedding_model_provider: 'azure_openai',
    })
    getDatasets.mockResolvedValue(datasetPage([first, second]))
    setupClassic({ id: 'group', name: 'Saved group', selectedDatasets: [first] })
    const original = snapshot().knowledge
    const dialog = await open(user)
    await advanced(user, dialog)
    await toggleDatasets(user, dialog, [/Azure docs/])
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getAllByRole('alert')[0]?.textContent).toMatch(/rerankModel/)
    expect(snapshot().knowledge).toEqual(original)
  })

  it('stages retrieval limit edits and discards them when the shared dialog is cancelled', async () => {
    const user = userEvent.setup()
    setupClassic({
      id: 'classic',
      name: 'Saved search',
      selectedDatasets: [createDatasetFixture()],
      multipleRetrievalConfig: { top_k: 4, score_threshold: null, reranking_enable: false },
    })
    const editLimit = async (dialog: HTMLElement) => {
      await advanced(user, dialog)
      await user.click(within(dialog).getByRole('button', { name: 'dataset.retrievalSettings' }))
      const topK = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
      expect(topK).toHaveValue('4')
      await user.clear(topK)
      await user.type(topK, '8')
      await user.tab()
      await user.keyboard('{Escape}')
    }
    let dialog = await open(user)
    await editLimit(dialog)
    await user.click(within(dialog).getByRole('button', { name: /operation.cancel/ }))
    expect(snapshot().knowledge.sets[0].retrieval.top_k).toBe(4)
    dialog = await open(user)
    await editLimit(dialog)
    expect(snapshot().knowledge.sets[0].retrieval.top_k).toBe(4)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets[0].retrieval).toMatchObject({
      mode: 'multiple',
      top_k: 8,
      reranking_mode: 'weighted_score',
      reranking_enable: true,
    })
  })

  it('removes a dataset with an unavailable embedding model before selecting a replacement', async () => {
    const user = userEvent.setup()
    const unavailable = createDatasetFixture({
      name: 'Unavailable docs',
      embedding_available: false,
    })
    const replacement = createDatasetFixture({ id: 'replacement', name: 'Replacement docs' })
    getDataset.mockResolvedValue(unavailable)
    getDatasets.mockResolvedValue(datasetPage([unavailable, replacement]))
    setupClassic({
      id: 'group',
      name: 'Saved group',
      datasetRefs: [{ id: unavailable.id, name: unavailable.name }],
      queryMode: 'custom',
      customQuery: 'support question',
      multipleRetrievalConfig: { top_k: 7, score_threshold: 0.4, reranking_enable: false },
    })
    const original = snapshot().knowledge
    const dialog = await open(user)
    await advanced(user, dialog)
    await user.click(
      await within(dialog).findByRole('button', {
        name: 'common.operation.remove Unavailable docs',
      }),
    )
    const picker = await openDatasetPicker(user, dialog)
    expect(await within(picker).findByRole('button', { name: /Unavailable docs/ })).toBeDisabled()
    await user.click(within(picker).getByRole('button', { name: /Replacement docs/ }))
    await confirmDatasetPicker(user, picker)
    expect(snapshot().knowledge).toEqual(original)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets).toEqual([
      expect.objectContaining({
        id: 'group',
        name: 'Saved group',
        datasets: [expect.objectContaining({ id: replacement.id })],
        query: { mode: 'user_query', value: 'support question' },
        retrieval: expect.objectContaining({ top_k: 7, score_threshold: 0.4 }),
      }),
    ])
  })

  it.each([
    {
      title: 'rejects unsupported operators even when field types match',
      from: MetadataFilteringVariableType.number,
      to: MetadataFilteringVariableType.number,
      operator: ComparisonOperator.contains,
      value: 12,
      valid: false,
    },
    {
      title: 'requires reconfiguration when the field type changes',
      from: MetadataFilteringVariableType.string,
      to: MetadataFilteringVariableType.number,
      operator: ComparisonOperator.empty,
      value: undefined,
      valid: false,
    },
    {
      title: 'retains compatible empty-value conditions',
      from: MetadataFilteringVariableType.number,
      to: MetadataFilteringVariableType.number,
      operator: ComparisonOperator.empty,
      value: undefined,
      valid: true,
    },
    {
      title: 'retains compatible timestamp conditions',
      from: MetadataFilteringVariableType.time,
      to: MetadataFilteringVariableType.time,
      operator: ComparisonOperator.after,
      value: 1700000000,
      valid: true,
    },
    {
      title: 'rejects string operators on a replacement numeric field',
      from: MetadataFilteringVariableType.string,
      to: MetadataFilteringVariableType.number,
      operator: ComparisonOperator.contains,
      value: 'abc',
      valid: false,
    },
    {
      title: 'rejects nonnumeric values on numeric fields',
      from: MetadataFilteringVariableType.number,
      to: MetadataFilteringVariableType.number,
      operator: ComparisonOperator.equal,
      value: 'abc',
      valid: false,
    },
    {
      title: 'retains compatible numeric conditions',
      from: MetadataFilteringVariableType.number,
      to: MetadataFilteringVariableType.number,
      operator: ComparisonOperator.equal,
      value: 12,
      valid: true,
    },
    {
      title: 'retains compatible list membership conditions',
      from: MetadataFilteringVariableType.string,
      to: MetadataFilteringVariableType.string,
      operator: ComparisonOperator.in,
      value: ['abc', 'def'],
      valid: true,
    },
    {
      title: 'rejects same-name fields with conflicting types within a group',
      from: MetadataFilteringVariableType.string,
      to: MetadataFilteringVariableType.number,
      operator: ComparisonOperator.contains,
      value: 'abc',
      valid: false,
      keepOriginal: true,
    },
  ])(
    '$title when changing datasets',
    async ({ from, to, operator, value, valid, keepOriginal = false }) => {
      const user = userEvent.setup()
      const source = createDatasetFixture({
        name: 'Original docs',
        doc_metadata: [{ id: 'old-code', name: 'code', type: from }],
      })
      const replacement = createDatasetFixture({
        id: 'replacement',
        name: 'Replacement docs',
        doc_metadata: [{ id: 'new-code', name: 'code', type: to }],
      })
      getDatasets.mockResolvedValue(datasetPage([source, replacement]))
      setupClassic({
        id: 'group',
        name: 'Saved group',
        selectedDatasets: [source],
        metadataFilterMode: MetadataFilteringModeEnum.manual,
        metadataFilteringConditions: {
          logical_operator: LogicalOperator.and,
          conditions: [
            {
              id: 'condition',
              metadata_id: 'old-code',
              name: 'code',
              comparison_operator: operator,
              value,
            },
          ],
        },
      })
      const original = snapshot().knowledge
      const dialog = await open(user)
      await advanced(user, dialog)
      const picker = await openDatasetPicker(user, dialog)
      if (!keepOriginal)
        await user.click(await within(picker).findByRole('button', { name: /Original docs/ }))
      await user.click(await within(picker).findByRole('button', { name: /Replacement docs/ }))
      await confirmDatasetPicker(user, picker)
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      if (valid) {
        expect(snapshot().knowledge.sets[0].metadata_filtering.conditions.conditions).toEqual([
          {
            id: 'condition',
            metadata_id: 'new-code',
            name: 'code',
            comparison_operator: operator,
            value,
          },
        ])
      } else {
        expect(dialog).toBeInTheDocument()
        expect(within(dialog).getAllByRole('alert')[0]?.textContent).toMatch(
          /metadata.panel.conditions/,
        )
        expect(snapshot().knowledge).toEqual(original)
      }
    },
  )

  it('retains Classic bindings when dataset lookup fails and supports retry', async () => {
    const user = userEvent.setup()
    getDataset.mockRejectedValue(new ORPCError('FORBIDDEN', { status: 403 }))
    setupClassic({ id: 'classic', name: 'Saved search', datasetRefs: [{ id: 'dataset-1' }] })
    const dialog = await open(user)
    await advanced(user, dialog)
    expect(await within(dialog).findByRole('alert')).toBeVisible()
    expect(snapshot().knowledge.sets[0].datasets).toEqual([{ id: 'dataset-1' }])
    getDataset.mockResolvedValue(createDatasetFixture())
    await user.click(within(dialog).getByRole('button', { name: /operation.retry/ }))
    expect(await within(dialog).findByRole('radio', { name: /dialog.query.agent$/ })).toBeVisible()
  })

  it.each([false, true])(
    'replaces deleted datasets without losing the group identity or saved settings (retained dataset=%s)',
    async (hasRetainedDataset) => {
      const user = userEvent.setup()
      const retained = createDatasetFixture({
        name: 'Retained docs',
        doc_metadata: [{ id: 'topic-retained', name: 'topic', type: 'string' }],
      })
      const replacement = createDatasetFixture({
        id: 'replacement',
        name: 'Replacement docs',
        doc_metadata: [{ id: 'topic-replacement', name: 'topic', type: 'string' }],
      })
      getDataset.mockImplementation(async ({ params }: { params: { dataset_id: string } }) => {
        if (params.dataset_id.startsWith('deleted'))
          throw new ORPCError('NOT_FOUND', { status: 404 })
        return retained
      })
      getDatasets.mockResolvedValue(datasetPage([retained, replacement]))
      setupClassic({
        id: 'saved-group',
        name: 'Saved group',
        datasetRefs: [
          ...(hasRetainedDataset ? [{ id: retained.id, name: retained.name }] : []),
          { id: 'deleted', name: 'Deleted docs' },
          { id: 'deleted-2', name: 'Other missing docs' },
        ],
        queryMode: 'custom',
        customQuery: 'support question',
        multipleRetrievalConfig: { top_k: 7, score_threshold: 0.4, reranking_enable: false },
        metadataFilterMode: MetadataFilteringModeEnum.manual,
        metadataFilteringConditions: {
          logical_operator: LogicalOperator.and,
          conditions: [
            {
              id: 'topic-condition',
              name: 'topic',
              comparison_operator: ComparisonOperator.is,
              value: 'agents',
            },
          ],
        },
      })
      const original = snapshot().knowledge
      const dialog = await open(user)
      await advanced(user, dialog)
      await user.click(
        await within(dialog).findByRole('button', { name: 'common.operation.remove Deleted docs' }),
      )
      await user.click(
        within(dialog).getByRole('button', { name: 'common.operation.remove Other missing docs' }),
      )
      await toggleDatasets(user, dialog, [/Replacement docs/])
      expect(snapshot().knowledge).toEqual(original)
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      expect(snapshot().knowledge.sets).toEqual([
        expect.objectContaining({
          id: 'saved-group',
          name: 'Saved group',
          datasets: [
            ...(hasRetainedDataset ? [expect.objectContaining({ id: retained.id })] : []),
            expect.objectContaining({ id: replacement.id }),
          ],
          query: { mode: 'user_query', value: 'support question' },
          retrieval: expect.objectContaining({ top_k: 7, score_threshold: 0.4 }),
          metadata_filtering: {
            mode: 'manual',
            conditions: {
              logical_operator: 'and',
              conditions: [
                {
                  id: 'topic-condition',
                  metadata_id: hasRetainedDataset ? 'topic-retained' : 'topic-replacement',
                  name: 'topic',
                  comparison_operator: 'is',
                  value: 'agents',
                },
              ],
            },
          },
        }),
      ])
    },
  )

  it.each([false, true])(
    'cleans incompatible metadata only after replacing datasets (shared field=%s)',
    async (hasSharedField) => {
      const user = userEvent.setup()
      const originalDataset = createDatasetFixture({
        name: 'Original docs',
        doc_metadata: [
          { id: 'topic-old', name: 'topic', type: 'string' },
          { id: 'language-old', name: 'language', type: 'string' },
        ],
      })
      const replacement = createDatasetFixture({
        id: 'replacement',
        name: 'Replacement docs',
        doc_metadata: hasSharedField
          ? [{ id: 'language-new', name: 'language', type: 'string' }]
          : [],
      })
      getDatasets.mockResolvedValue(datasetPage([originalDataset, replacement]))
      setupClassic({
        id: 'group',
        name: 'Saved group',
        selectedDatasets: [originalDataset],
        metadataFilterMode: MetadataFilteringModeEnum.manual,
        metadataFilteringConditions: {
          logical_operator: LogicalOperator.and,
          conditions: [
            {
              id: 'topic-condition',
              metadata_id: 'topic-old',
              name: 'topic',
              comparison_operator: ComparisonOperator.is,
              value: 'agents',
            },
            {
              id: 'language-condition',
              metadata_id: 'language-old',
              name: 'language',
              comparison_operator: ComparisonOperator.is,
              value: 'en',
            },
          ],
        },
      })
      const original = snapshot().knowledge
      const dialog = await open(user)
      await advanced(user, dialog)
      const picker = await openDatasetPicker(user, dialog)
      await user.click(await within(picker).findByRole('button', { name: /Original docs/ }))
      await user.click(within(picker).getByRole('button', { name: /Replacement docs/ }))
      await confirmDatasetPicker(user, picker)
      expect(snapshot().knowledge).toEqual(original)
      const conditions = within(dialog).getByRole('button', { name: /metadata.panel.conditions/ })
      await user.click(conditions)
      expect(screen.queryByRole('group', { name: 'topic' })).not.toBeInTheDocument()
      expect(screen.queryByDisplayValue('agents')).not.toBeInTheDocument()
      if (hasSharedField)
        expect(
          within(screen.getByRole('group', { name: 'language' })).getByRole('textbox'),
        ).toHaveValue('en')
      await user.click(conditions)
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      if (hasSharedField) {
        expect(snapshot().knowledge.sets[0].metadata_filtering.conditions.conditions).toEqual([
          {
            id: 'language-condition',
            metadata_id: 'language-new',
            name: 'language',
            comparison_operator: 'is',
            value: 'en',
          },
        ])
      } else {
        expect(dialog).toBeInTheDocument()
        expect(within(dialog).getAllByRole('alert')[0]?.textContent).toMatch(
          /metadata.panel.conditions/,
        )
        expect(snapshot().knowledge).toEqual(original)
        await user.click(
          within(dialog).getByRole('button', { name: /metadata.options.manual.title/ }),
        )
        await user.click(
          screen.getByRole('menuitemradio', { name: /metadata.options.disabled.title/ }),
        )
        await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
        expect(snapshot().knowledge.sets[0].metadata_filtering).toEqual({ mode: 'disabled' })
      }
      expect(snapshot().knowledge.sets[0].datasets).toEqual([
        expect.objectContaining({ id: replacement.id }),
      ])
    },
  )

  it.each(['zero', 'empty operator'])(
    'blocks an unfilled metadata value and accepts correction with %s',
    async (correction) => {
      const user = userEvent.setup()
      const dataset = createDatasetFixture({
        doc_metadata: [{ id: 'price', name: 'price', type: 'number' }],
      })
      setupClassic({ id: 'classic', name: 'Saved search', selectedDatasets: [dataset] })
      const original = snapshot().knowledge
      const dialog = await open(user)
      await advanced(user, dialog)
      await user.click(
        within(dialog).getByRole('button', { name: /metadata.options.disabled.title/ }),
      )
      await user.click(screen.getByRole('menuitemradio', { name: /metadata.options.manual.title/ }))
      const conditions = within(dialog).getByRole('button', { name: /metadata.panel.conditions/ })
      await user.click(conditions)
      await user.click(
        screen.getByRole('button', {
          name: 'workflowModels.nodes.knowledgeRetrieval.metadata.panel.add',
        }),
      )
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', { name: /price/ }),
      )
      await user.click(conditions)
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      expect(dialog).toBeInTheDocument()
      expect(within(dialog).getByText(/valueOfVarRequired.*price/)).toBeVisible()
      expect(snapshot().knowledge).toEqual(original)
      await user.click(conditions)
      const price = within(screen.getByRole('group', { name: 'price' }))
      if (correction === 'zero') {
        await user.type(price.getByRole('textbox'), '0')
        await user.tab()
      } else {
        await user.click(price.getByRole('button', { name: '=' }))
        await user.click(screen.getByText('workflowLogic.nodes.ifElse.comparisonOperator.empty'))
      }
      await user.click(conditions)
      expect(within(dialog).queryByText(/valueOfVarRequired.*price/)).not.toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      expect(snapshot().knowledge.sets[0].metadata_filtering.conditions.conditions).toEqual([
        expect.objectContaining({
          name: 'price',
          comparison_operator: correction === 'zero' ? '=' : 'empty',
          ...(correction === 'zero' ? { value: 0 } : {}),
        }),
      ])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('saves edited metadata conditions and their logical operator only on confirmation', async () => {
    const user = userEvent.setup()
    const dataset = createDatasetFixture({
      doc_metadata: [
        { id: 'topic', name: 'topic', type: 'string' },
        { id: 'author', name: 'author', type: 'string' },
      ],
    })
    setupClassic({ id: 'classic', name: 'Saved search', selectedDatasets: [dataset] })
    const original = snapshot().knowledge
    const dialog = await open(user)
    await advanced(user, dialog)
    await user.click(
      within(dialog).getByRole('button', { name: /metadata.options.disabled.title/ }),
    )
    await user.click(screen.getByRole('menuitemradio', { name: /metadata.options.manual.title/ }))
    await user.click(within(dialog).getByRole('button', { name: /metadata.panel.conditions/ }))
    const addCondition = async (name: string) => {
      await user.click(
        screen.getByRole('button', {
          name: 'workflowModels.nodes.knowledgeRetrieval.metadata.panel.add',
        }),
      )
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', { name: new RegExp(name) }),
      )
    }
    await addCondition('topic')
    await user.type(
      within(screen.getByRole('group', { name: 'topic' })).getByRole('textbox'),
      'agent',
    )
    await addCondition('author')
    const author = within(screen.getByRole('group', { name: 'author' }))
    await user.type(author.getByRole('textbox'), 'Ada')
    await user.click(screen.getByText('AND'))
    await user.click(
      within(screen.getByRole('group', { name: 'topic' })).getByRole('button', {
        name: 'common.operation.remove',
      }),
    )
    await user.click(within(dialog).getByRole('button', { name: /metadata.panel.conditions/ }))
    expect(snapshot().knowledge).toEqual(original)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets[0].metadata_filtering).toEqual({
      mode: 'manual',
      conditions: {
        logical_operator: 'or',
        conditions: [
          expect.objectContaining({
            name: 'author',
            metadata_id: 'author',
            comparison_operator: 'is',
            value: 'Ada',
          }),
        ],
      },
    })
  })

  it.each(['single retrieval', 'automatic metadata'] as const)(
    'saves the %s model and parameters through the shared dialog',
    async (target) => {
      const user = userEvent.setup()
      const { queryClient } = setupClassic({
        id: 'classic',
        name: 'Saved search',
        selectedDatasets: [createDatasetFixture()],
        ...(target === 'single retrieval'
          ? {
              retrievalMode: RETRIEVE_TYPE.oneWay,
              singleRetrievalConfig: {
                model: {
                  provider: 'openai',
                  name: 'gpt-4',
                  mode: 'chat',
                  completion_params: { temperature: 0.7 },
                },
              },
            }
          : {}),
      })
      seedModelProviderQueries(queryClient, [
        createModelCatalogFixture({
          models: [
            createCatalogModelFixture({ model_properties: { mode: 'chat' } }),
            createCatalogModelFixture({
              model: 'gpt-4.1',
              label: { en_US: 'GPT-4.1' },
              model_properties: { mode: 'chat' },
            }),
          ],
        }),
      ])
      const original = snapshot().knowledge
      const dialog = await open(user)
      await advanced(user, dialog)
      if (target === 'single retrieval') {
        await user.click(within(dialog).getByRole('button', { name: 'dataset.retrievalSettings' }))
        await user.click(screen.getByRole('button', { name: /^GPT-4 CHAT$/ }))
      } else {
        await user.click(
          within(dialog).getByRole('button', { name: /metadata.options.disabled.title/ }),
        )
        await user.click(
          screen.getByRole('menuitemradio', { name: /metadata.options.automatic.title/ }),
        )
        await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
      }
      await user.click(
        within(
          await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
        ).getByRole('button', { name: /^GPT-4.1/ }),
      )
      await user.click(
        screen.getByRole('button', { name: 'modelProvider.modelProvider.modelSettings' }),
      )
      const params = within(
        await screen.findByRole('dialog', { name: 'modelProvider.modelProvider.modelSettings' }),
      )
      await user.clear(params.getByRole('spinbutton', { name: 'Temperature' }))
      await user.type(params.getByRole('spinbutton', { name: 'Temperature' }), '0.2')
      await user.tab()
      await user.click(params.getByRole('button', { name: 'common.operation.close' }))
      if (target === 'single retrieval') await user.keyboard('{Escape}')
      expect(snapshot().knowledge).toEqual(original)
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      const saved = snapshot().knowledge.sets[0]
      expect(
        target === 'single retrieval' ? saved.retrieval : saved.metadata_filtering,
      ).toMatchObject({
        mode: target === 'single retrieval' ? 'single' : 'automatic',
        [target === 'single retrieval' ? 'model' : 'model_config']: {
          provider: 'openai',
          name: 'gpt-4.1',
          mode: 'chat',
          completion_params: { temperature: 0.2 },
        },
      })
    },
  )

  it('recovers the Classic catalog after an error and loads later pages without losing selections', async () => {
    const user = userEvent.setup()
    getDatasets.mockRejectedValueOnce(new ORPCError('INTERNAL_SERVER_ERROR'))
    setup([], { enabled: false })
    const dialog = await open(user)
    expect(await within(dialog).findByRole('alert')).toBeVisible()
    getDatasets.mockResolvedValueOnce({ ...datasetPage(), has_more: true })
    await user.click(within(dialog).getByRole('button', { name: /operation.retry/ }))
    await user.click(
      await within(dialog).findByRole('option', { name: optionName('Test Dataset') }),
    )
    getDatasets.mockResolvedValueOnce({
      ...datasetPage([createDatasetFixture({ id: 'dataset-2', name: 'More docs' })]),
      page: 2,
    })
    await user.click(within(dialog).getByRole('button', { name: /loadMore/ }))
    await user.click(await within(dialog).findByRole('option', { name: optionName('More docs') }))
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets.map((item: { name: string }) => item.name)).toEqual([
      'Test Dataset',
      'More docs',
    ])
  })

  it('keeps Classic options in place while they are ticked and unticked', async () => {
    const user = userEvent.setup()
    getDatasets.mockResolvedValue(
      datasetPage([
        createDatasetFixture({ id: 'dataset-1', name: 'Alpha' }),
        createDatasetFixture({ id: 'dataset-2', name: 'Beta' }),
        createDatasetFixture({ id: 'dataset-3', name: 'Gamma' }),
      ]),
    )
    setupClassic({
      id: 'saved-set',
      name: 'Saved search',
      description: '',
      selectedDatasets: [createDatasetFixture({ id: 'dataset-saved', name: 'Saved docs' })],
      queryMode: 'agent',
    })
    const dialog = await open(user)
    await within(dialog).findByRole('option', { name: optionName('Gamma') })
    const initialOrder = ['Saved search', 'Alpha', 'Beta', 'Gamma']
    const optionNames = () =>
      within(dialog)
        .getAllByRole('option')
        .map((option) => initialOrder.find((name) => option.textContent?.startsWith(name)))
    expect(optionNames()).toEqual(initialOrder)

    await user.click(within(dialog).getByRole('option', { name: optionName('Gamma') }))
    await user.click(within(dialog).getByRole('option', { name: optionName('Beta') }))
    expect(optionNames()).toEqual(initialOrder)
    await user.click(within(dialog).getByRole('option', { name: optionName('Gamma') }))
    await user.click(within(dialog).getByRole('option', { name: optionName('Saved search') }))
    expect(optionNames()).toEqual(initialOrder)

    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets.map((item: { name: string }) => item.name)).toEqual(['Beta'])
  })
})

describe('KnowledgeFS composer interaction', () => {
  it('selects multiple real names and commits only on confirmation', async () => {
    const user = userEvent.setup()
    setup()
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('option', { name: optionName('Product manual') }))
    await user.click(within(dialog).getByRole('option', { name: optionName('Engineering') }))
    expect(snapshot().knowledge.spaces).toEqual([])
    expect(within(dialog).queryByText(/retrievalSetting/)).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('textbox', { name: /knowledgeFs.alias/ }),
    ).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.spaces.map((item: { name: string }) => item.name)).toEqual([
      'Product manual',
      'Engineering',
    ])
    expect(snapshot().knowledge.spaces[0].description).toBe('A real knowledge space')
    expect(snapshot().knowledge.sets).toEqual([])
  })

  it('keeps knowledge descriptions accessible without a separate help action', async () => {
    const user = userEvent.setup()
    setup([], { spaces: [space()] })
    const dialog = await open(user)
    const list = within(dialog).getByRole('listbox', { name: /knowledgeRetrieval.dialog.title/ })
    expect(within(list).queryByRole('button')).not.toBeInTheDocument()
    const option = within(list).getByRole('option', {
      name: 'Product manual A real knowledge space',
    })
    await user.click(option)
    expect(option).toHaveAttribute('aria-selected', 'true')
    await user.click(within(dialog).getByRole('button', { name: /advancedSettings.label/ }))
    expect(within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ })).toHaveValue(
      'Product manual',
    )
    expect(
      within(dialog).getByRole('textbox', { name: /knowledgeFs.bindingDescription/ }),
    ).toHaveValue('A real knowledge space')
    expect(snapshot().knowledge.spaces).toEqual([])
  })

  it('limits Agent Knowledge Bases to 10 while retaining a Classic binding', async () => {
    const user = userEvent.setup()
    setup([{ id: 'classic', name: 'Classic Docs', datasetRefs: [{ id: 'dataset-1' }] }], {
      spaces: Array.from({ length: 11 }, (_, index) =>
        space(
          `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          `Space ${index + 1}`,
        ),
      ),
    })
    const dialog = await open(user)
    for (let index = 1; index <= 10; index++) {
      await user.click(within(dialog).getByRole('option', { name: optionName(`Space ${index}`) }))
    }
    const search = within(dialog).getByRole('combobox', { name: /operation.search/ })
    await user.type(search, 'Space 11')
    expect(within(dialog).getByRole('option', { name: optionName('Space 11') })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.clear(search)
    await user.click(within(dialog).getByRole('option', { name: optionName('Space 1') }))
    await user.click(within(dialog).getByRole('option', { name: optionName('Space 11') }))
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.spaces).toHaveLength(10)
    expect(snapshot().knowledge.sets).toHaveLength(1)
    expect(
      snapshot().knowledge.spaces.some((item: { name: string }) => item.name === 'Space 11'),
    ).toBe(true)
  })

  it('reveals invalid optional settings on submit without losing their draft', async () => {
    const user = userEvent.setup()
    setup([binding])
    const dialog = await open(user)
    const advanced = within(dialog).getByRole('button', { name: /advancedSettings.label/ })
    await user.click(advanced)
    await user.clear(within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ }))
    await user.click(advanced)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(advanced)
    expect(within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ })).toHaveValue('')
    expect(within(dialog).getByRole('alert')).toBeInTheDocument()
    expect(snapshot().knowledge.spaces[0].name).toBe('Product manual')
  })

  it('discards cancelled edits and resets the next dialog draft', async () => {
    const user = userEvent.setup()
    setup([binding])
    let dialog = await open(user)
    await user.click(within(dialog).getByRole('button', { name: /advancedSettings.label/ }))
    const alias = within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ })
    await user.clear(alias)
    await user.type(alias, 'Unsaved')
    await user.click(within(dialog).getByRole('button', { name: /operation.cancel/ }))
    expect(snapshot().knowledge.spaces[0].name).toBe('Product manual')
    dialog = await open(user)
    expect(
      within(dialog).queryByRole('textbox', { name: /knowledgeFs.alias/ }),
    ).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /advancedSettings.label/ }))
    expect(within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ })).toHaveValue(
      'Product manual',
    )
  })

  it('leaves the advanced settings focus indicator to the Collapsible primitive', async () => {
    const user = userEvent.setup()
    setup([binding])
    const dialog = await open(user)
    const advanced = within(dialog).getByRole('button', { name: /advancedSettings.label/ })
    expect(advanced.className.split(/\s+/)).not.toContain('outline-hidden')
  })

  it('renames a stable binding and its prompt reference, then removes it', async () => {
    const user = userEvent.setup()
    setup([binding])
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('button', { name: /advancedSettings.label/ }))
    expect(within(dialog).queryByText(SPACE)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(binding.id)).not.toBeInTheDocument()
    const alias = within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ })
    await user.clear(alias)
    await user.type(alias, 'Support docs')
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.spaces[0]).toMatchObject({ id: 'docs', name: 'Support docs' })
    expect(snapshot().prompt).toContain('Support docs')
    await user.click(screen.getByRole('button', { name: /knowledgeRetrieval.remove/ }))
    expect(snapshot().knowledge.spaces).toEqual([])
  })

  it('requires explicit rebind after import', async () => {
    const user = userEvent.setup()
    setup([{ ...binding, isMissing: true }])
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(snapshot().knowledge.spaces[0].is_missing).toBe(true)
    await user.click(within(dialog).getByRole('option', { name: optionName('Product manual') }))
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.spaces[0].is_missing).toBe(false)
  })

  it.each(['all_team_members', 'partial_members'] as const)(
    'allows selecting a %s space with read and query permissions',
    async (visibility) => {
      const user = userEvent.setup()
      setup([], {
        spaces: [
          {
            ...space(),
            visibility,
            permission_keys: ['knowledge_space_read', 'knowledge_space_query'],
          },
        ],
      })
      const dialog = await open(user)
      await user.click(within(dialog).getByRole('option', { name: optionName('Product manual') }))
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      expect(snapshot().knowledge.spaces).toEqual([
        expect.objectContaining({ control_space_id: SPACE, name: 'Product manual' }),
      ])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it.each(['knowledge_space_read', 'knowledge_space_query'] as const)(
    'hides spaces without %s even when filtering by name',
    async (permission) => {
      const user = userEvent.setup()
      const restricted = space(SECOND, 'Restricted')
      restricted.permission_keys = restricted.permission_keys.filter((key) => key !== permission)
      setup([], { spaces: [space(), restricted] })
      const dialog = await open(user)
      expect(within(dialog).getAllByRole('option')).toHaveLength(1)
      expect(within(dialog).queryByText('Restricted')).not.toBeInTheDocument()
      await user.type(
        within(dialog).getByRole('combobox', { name: /operation.search/ }),
        'Restricted',
      )
      expect(within(dialog).queryByRole('option')).not.toBeInTheDocument()
      expect(within(dialog).getByText(/knowledgeFs.empty/)).toBeVisible()
      expect(within(dialog).queryByText(/knowledgeFs.publishPermission/)).not.toBeInTheDocument()
    },
  )

  it('hides unavailable and inactive spaces from the candidate list', async () => {
    const user = userEvent.setup()
    setup([], {
      spaces: [space(SPACE, 'Unavailable', false), { ...space(SECOND), state: 'deleting' }],
    })
    const dialog = await open(user)
    expect(within(dialog).queryByRole('option')).not.toBeInTheDocument()
    expect(within(dialog).getByText(/knowledgeFs.empty/)).toBeVisible()
  })

  it.each(['forbidden', 'missing'] as const)(
    'preserves a %s existing binding until the user explicitly removes it',
    async (status) => {
      const user = userEvent.setup()
      setup([binding], {
        spaces: status === 'missing' ? [] : [{ ...space(), permission_keys: [] }],
      })
      const dialog = await open(user)
      expect(
        within(dialog).getByRole('option', { name: optionName('Product manual') }),
      ).toHaveAttribute('aria-selected', 'true')
      expect(snapshot().knowledge.spaces[0]).toMatchObject({ id: binding.id })
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      expect(dialog).toBeInTheDocument()
      expect(within(dialog).getByRole('alert').textContent).toMatch(/knowledgeFs.unavailable/)
      const advanced = within(dialog).getByRole('button', { name: /advancedSettings.label/ })
      await user.click(advanced)
      expect(within(dialog).queryByText(SPACE)).not.toBeInTheDocument()
      await user.click(within(dialog).getByRole('option', { name: optionName('Product manual') }))
      expect(snapshot().knowledge.spaces).toHaveLength(1)
      await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
      expect(snapshot().knowledge.spaces).toEqual([])
    },
  )

  it('does not infer lost permission from a partially loaded catalog', async () => {
    const user = userEvent.setup()
    setup([binding], { spaces: [space(SECOND, 'Engineering')], hasMore: true })
    const dialog = await open(user)
    expect(within(dialog).queryByText(/knowledgeFs.unavailable/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.spaces[0]).toMatchObject({ id: binding.id })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rechecks refreshed permissions without dropping the in-progress selection', async () => {
    const user = userEvent.setup()
    const { queryClient } = setup([], { spaces: [space()] })
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('option', { name: optionName('Product manual') }))
    const options = consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
      initialPageParam: 1,
      getNextPageParam: () => undefined,
    })
    const refresh = (spaces: KnowledgeFsSpaceListItemResponse[]) =>
      queryClient.setQueryData(options.queryKey, {
        pages: [
          zKnowledgeFsSpaceListResponse.parse({
            data: spaces,
            page: 1,
            limit: 50,
            has_more: false,
          }),
        ],
        pageParams: [1],
      })
    refresh([{ ...space(), permission_keys: ['knowledge_space_read'] }])
    await waitFor(() =>
      expect(
        within(dialog).getByRole('option', { name: /knowledgeFs.unavailable/ }),
      ).toHaveAttribute('aria-selected', 'true'),
    )
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(within(dialog).getByRole('alert').textContent).toMatch(/knowledgeFs.unavailable/)
    await user.click(within(dialog).getByRole('button', { name: /advancedSettings.label/ }))
    expect(within(dialog).getByRole('textbox', { name: /knowledgeFs.alias/ })).toHaveValue(
      'Product manual',
    )
    expect(snapshot().knowledge.spaces).toEqual([])
    refresh([space()])
    expect(
      await within(dialog).findByRole('option', { name: optionName('Product manual') }),
    ).toHaveAttribute('aria-selected', 'true')
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.spaces[0]).toMatchObject({
      control_space_id: SPACE,
      name: 'Product manual',
    })
  })

  it('keeps Classic bindings when adding an Agent Knowledge Base', async () => {
    const user = userEvent.setup()
    setup([{ id: 'legacy', name: 'Old documents', datasetRefs: [{ id: 'dataset' }] }])
    const dialog = await open(user)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(snapshot().knowledge.sets).toHaveLength(1)
    await user.click(within(dialog).getByRole('option', { name: optionName('Product manual') }))
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(snapshot().knowledge.sets[0]).toMatchObject({
      id: 'legacy',
      datasets: [{ id: 'dataset' }],
    })
    expect(snapshot().knowledge.spaces).toHaveLength(1)
  })

  it('offers only Classic knowledge when KnowledgeFS is unavailable', () => {
    setup([], { enabled: false })
    expect(screen.queryByRole('heading', { name: /knowledgeFs.title/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /knowledgeFs.add/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /knowledgeRetrieval.add/ })).toBeEnabled()
    expect(screen.queryByText(/knowledgeFs.runtimeUnavailable/)).not.toBeInTheDocument()
  })

  it('allows removing Classic bindings while preserving hidden KnowledgeFS bindings', async () => {
    const user = userEvent.setup()
    const { queryClient } = setup(
      [binding, { id: 'classic', name: 'Classic Docs', datasetRefs: [{ id: 'dataset' }] }],
      { enabled: false },
    )

    expect(screen.getByText('Classic Docs')).toBeInTheDocument()
    expect(screen.queryByText('Product manual')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /knowledgeFs.title/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /knowledgeFs.add/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /knowledgeRetrieval.edit/ })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /knowledgeRetrieval.remove/ }))

    expect(snapshot().knowledge.sets).toEqual([])
    expect(snapshot().knowledge.spaces[0]).toMatchObject({ id: binding.id })
    expect(screen.getByRole('heading', { name: /knowledgeRetrieval.label/ })).toBeInTheDocument()

    act(() => {
      seedKnowledgeFsFeatures(queryClient, { agent_enabled: true })
    })

    expect(await screen.findByText('Product manual')).toBeInTheDocument()
    expect(screen.queryByText('Classic Docs')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /knowledgeRetrieval.add/ })).toBeEnabled()
  })

  it('does not offer additions when viewing a historical version', () => {
    setup([binding], { viewingVersion: true })
    expect(screen.queryByRole('button', { name: /knowledgeRetrieval.add/ })).not.toBeInTheDocument()
  })

  it('keeps sibling composers isolated', async () => {
    const user = userEvent.setup()
    setup([binding], { label: 'first' })
    setup([], { label: 'second' })
    const firstAdd = screen.getAllByRole('button', { name: /knowledgeRetrieval.add/ })[0]
    if (!firstAdd) throw new Error('First composer must expose an add button')
    await user.click(firstAdd)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('option', { name: optionName('Engineering') }))
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(
      JSON.parse(screen.getByLabelText('first').textContent ?? '{}').knowledge.spaces,
    ).toHaveLength(2)
    expect(
      JSON.parse(screen.getByLabelText('second').textContent ?? '{}').knowledge.spaces,
    ).toEqual([])
  })

  it('does not mutate a read-only composer', () => {
    setup([binding], { readOnly: true })
    expect(screen.getByRole('button', { name: /knowledgeRetrieval.add/ })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: /knowledgeRetrieval.remove/ }),
    ).not.toBeInTheDocument()
  })

  it('rejects duplicate aliases at confirmation without changing the composer', async () => {
    const user = userEvent.setup()
    setup([binding])
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('option', { name: optionName('Engineering') }))
    await user.click(within(dialog).getByRole('button', { name: /advancedSettings.label/ }))
    const aliases = within(dialog).getAllByRole('textbox', { name: /knowledgeFs.alias/ })
    const secondAlias = aliases[1]
    if (!secondAlias) throw new Error('Second binding must expose an alias field')
    await user.clear(secondAlias)
    await user.type(secondAlias, 'Product manual')
    await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toBeInTheDocument()
    expect(snapshot().knowledge.spaces).toHaveLength(1)
  })
})
