import type {
  KnowledgeFsUpgradeJobResponse,
  KnowledgeFsUpgradePreparationResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { ORPCError } from '@orpc/client'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { KnowledgeUpgradeDialog } from '../knowledge-upgrade-dialog'

const startUpgradeMock = vi.hoisted(() => vi.fn())
const discoverUpgradeMock = vi.hoisted(() => vi.fn())
const getModelsMock = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.knowledgeFsUpgrades.get': discoverUpgradeMock,
      'datasets.byDatasetId.knowledgeFsUpgrades.post': startUpgradeMock,
      'workspaces.current.models.modelTypes.byModelType.get': getModelsMock,
    }),
  }
})

const dataset = createDatasetFixture({ name: 'Support knowledge' })

const job = {
  completed_documents: 0,
  completed_sources: 0,
  id: 'upgrade-1',
  old_dataset_id: dataset.id,
  snapshot_at: '2026-08-18T00:00:00Z',
  stage: 'validating',
  status: 'queued',
  total_documents: 0,
  total_sources: 0,
} satisfies KnowledgeFsUpgradeJobResponse

const modelCatalogs = [
  createModelCatalogFixture({
    provider: 'langgenius/openai/openai',
    models: [
      ...['gpt-4o', 'gpt-4o-mini'].map((model) =>
        createCatalogModelFixture({ model, label: { en_US: model }, model_type: 'llm' }),
      ),
      createCatalogModelFixture({
        model: 'text-embedding-3-small',
        label: { en_US: 'text-embedding-3-small' },
        model_type: 'text-embedding',
      }),
    ],
  }),
  createModelCatalogFixture({
    provider: 'langgenius/cohere/cohere',
    models: ['rerank-english', 'rerank-multilingual'].map((model) =>
      createCatalogModelFixture({ model, label: { en_US: model }, model_type: 'rerank' }),
    ),
  }),
]

const recommendedModels = {
  embedding: {
    available: true,
    source: 'legacy',
    value: { model: 'text-embedding-3-small', provider: 'openai' },
  },
  rerank: {
    available: true,
    source: 'workspace_default',
    value: { model: 'rerank-english', provider: 'langgenius/cohere/cohere' },
  },
  reasoning: {
    available: true,
    source: 'workspace_default',
    value: { model: 'gpt-4o', provider: 'langgenius/openai/openai' },
  },
} satisfies NonNullable<KnowledgeFsUpgradePreparationResponse['models']>

const expectedPayload = {
  embedding: { model: 'text-embedding-3-small', provider: 'langgenius/openai/openai' },
  rerank: { model: 'rerank-english', provider: 'langgenius/cohere/cohere' },
  reasoning: { model: 'gpt-4o', provider: 'langgenius/openai/openai' },
}

function renderDialog({ onCancel = vi.fn(), onStarted = vi.fn() } = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, modelCatalogs)
  return renderWithConsoleQuery(
    <QueryTestingAdapter>
      <KnowledgeUpgradeDialog dataset={dataset} onCancel={onCancel} onStarted={onStarted} />
    </QueryTestingAdapter>,
    { queryClient },
  )
}

const startButton = () => screen.getByRole('button', { name: 'knowledgeUpgrade.upgrade.start' })
// The start button only reports its loading state through data attributes, so wait for the
// recommended models to render before treating the dialog as ready.
async function waitForRecommendedModels() {
  await screen.findByRole('button', {
    name: /knowledgeSettings.settings.systemReasoningModelLabel.*gpt-4o/,
  })
  await waitFor(() => expect(startButton()).toBeEnabled())
}
const reasoningSelector = () =>
  screen.getByRole('button', { name: /knowledgeSettings.settings.systemReasoningModelLabel/ })

describe('KnowledgeUpgradeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    discoverUpgradeMock.mockResolvedValue({
      can_retry: false,
      can_upgrade: true,
      job: null,
      models: recommendedModels,
    } satisfies KnowledgeFsUpgradePreparationResponse)
    getModelsMock.mockImplementation(({ params }: { params: { model_type: string } }) =>
      Promise.resolve({
        data: modelCatalogs
          .map((provider) => ({
            ...provider,
            models: provider.models.filter((model) => model.model_type === params.model_type),
          }))
          .filter((provider) => provider.models.length),
      }),
    )
  })

  it('offers upgrade details and documentation before requiring an explicit confirmation', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderDialog({ onCancel })

    expect(screen.getByText('knowledgeUpgrade.upgrade.dialogDuration')).toBeVisible()
    expect(screen.getByText('knowledgeUpgrade.upgrade.dialogLinkedApps')).toBeVisible()
    const learnMore = screen.getByRole('link', { name: 'knowledgeSpace.learnMore' })
    expect(learnMore.getAttribute('href')).toMatch(
      /\/use-dify\/knowledge-base\/upgrade-from-classic$/,
    )
    expect(learnMore).toHaveAttribute('target', '_blank')
    expect(screen.getByText(/knowledgeUpgrade\.upgrade\.summary/)).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'knowledgeSpace.modelCost.title' }),
    ).toHaveTextContent('knowledgeUpgrade.upgrade.modelCostDescription')
    expect(startButton()).toHaveAccessibleDescription(
      expect.stringContaining('knowledgeUpgrade.upgrade.modelCostDescription'),
    )
    await waitForRecommendedModels()
    expect(startUpgradeMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(startUpgradeMock).not.toHaveBeenCalled()
  })

  it('prefills recommended models and sends them with the upgrade request', async () => {
    startUpgradeMock.mockResolvedValue(job)
    const onStarted = vi.fn()
    const user = userEvent.setup()
    renderDialog({ onStarted })

    expect(
      await screen.findByRole('button', {
        name: /knowledgeSettings.settings.embeddingModelLabel.*text-embedding-3-small/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'knowledgeCreate.modelSettings' }),
    ).toBeInTheDocument()
    await user.click(startButton())

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(dataset, job))
    expect(startUpgradeMock).toHaveBeenCalledWith({
      body: { models: expectedPayload },
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { dataset_id: 'dataset-1' },
    })
  })

  it('requires a choice when a recommended model is unavailable', async () => {
    discoverUpgradeMock.mockResolvedValue({
      can_retry: false,
      can_upgrade: true,
      job: null,
      models: {
        ...recommendedModels,
        reasoning: {
          available: false,
          source: 'legacy',
          unavailable_reason: 'not_found',
          value: { model: 'retired-model', provider: 'langgenius/openai/openai' },
        },
      },
    } satisfies KnowledgeFsUpgradePreparationResponse)
    startUpgradeMock.mockResolvedValue(job)
    const user = userEvent.setup()
    renderDialog()

    expect(
      await screen.findByText('knowledgeSettings.settings.systemReasoningModelRequired'),
    ).toBeVisible()
    expect(reasoningSelector()).not.toHaveTextContent('retired-model')
    expect(startButton()).toBeDisabled()

    await user.click(reasoningSelector())
    await user.click(await screen.findByRole('button', { name: 'gpt-4o-mini' }))
    await waitFor(() => expect(startButton()).toBeEnabled())
    await user.click(startButton())

    await waitFor(() =>
      expect(startUpgradeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            models: {
              ...expectedPayload,
              reasoning: { model: 'gpt-4o-mini', provider: 'langgenius/openai/openai' },
            },
          },
        }),
      ),
    )
  })

  it('reuses the idempotency key for retries and rotates it when the model choice changes', async () => {
    startUpgradeMock
      .mockRejectedValueOnce(new Error('response lost'))
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(job)
    const onStarted = vi.fn()
    const user = userEvent.setup()
    renderDialog({ onStarted })

    await waitForRecommendedModels()
    await user.click(startButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeUpgrade.upgrade.startFailed',
    )
    await user.click(startButton())
    await waitFor(() => expect(startUpgradeMock).toHaveBeenCalledTimes(2))

    await user.click(reasoningSelector())
    await user.click(await screen.findByRole('button', { name: 'gpt-4o-mini' }))
    await user.click(startButton())

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(dataset, job))
    const keys = startUpgradeMock.mock.calls.map(([input]) => input.headers['Idempotency-Key'])
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
    expect(discoverUpgradeMock).toHaveBeenCalledWith({ params: { dataset_id: 'dataset-1' } })
  })

  it('keeps the dialog open and marks rejected models when the backend reports them unavailable', async () => {
    startUpgradeMock.mockRejectedValueOnce(
      new ORPCError('knowledge_fs_upgrade_models_unavailable', {
        defined: true,
        status: 422,
        data: {
          code: 'knowledge_fs_upgrade_models_unavailable',
          message: 'Models unavailable',
          status: 422,
          details: {
            issues: [
              {
                field: 'reasoning',
                model: 'gpt-4o',
                provider: 'langgenius/openai/openai',
                reason: 'quota-exceeded',
              },
            ],
          },
        },
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    await waitForRecommendedModels()
    getModelsMock.mockClear()
    await user.click(startButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeUpgrade.upgrade.modelsUnavailable',
    )
    expect(reasoningSelector()).toHaveAccessibleDescription(
      expect.stringContaining('knowledgeCreate.modelUnavailable'),
    )
    expect(startButton()).toBeDisabled()
    await waitFor(() =>
      expect(getModelsMock).toHaveBeenCalledWith({ params: { model_type: 'llm' } }),
    )

    await user.click(reasoningSelector())
    await user.click(await screen.findByRole('button', { name: 'gpt-4o-mini' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(reasoningSelector()).not.toHaveAccessibleDescription(
      expect.stringContaining('knowledgeCreate.modelUnavailable'),
    )
    await waitFor(() => expect(startButton()).toBeEnabled())
  })
})
