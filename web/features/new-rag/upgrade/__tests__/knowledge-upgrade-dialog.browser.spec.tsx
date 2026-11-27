import type { KnowledgeFsUpgradePreparationResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { useRef } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createErrorToastCaches } from '@/app/query-error-toast'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, setupFakeApi } from '@/test/fake-api'
import {
  expectedUpgradeModels as expectedPayload,
  upgradeModelCatalogs as modelCatalogs,
  recommendedUpgradeModels as recommendedModels,
  seedUpgradeModels,
  upgradeDataset,
  upgradeJob,
} from '@/test/new-rag-upgrade'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { KnowledgeUpgradeCard } from '../knowledge-upgrade-card'
import { KnowledgeUpgradeProvider } from '../knowledge-upgrade-context'
import { useKnowledgeUpgrade } from '../knowledge-upgrade-context-value'

// The upgrade contracts address datasets by UUID.
const datasetId = '3f0b6c8e-2a4d-4e8f-9b1a-7c5d2e6f8a90'
const dataset = { ...upgradeDataset, id: datasetId }
const job = { ...upgradeJob, old_dataset_id: datasetId }

const fake = setupFakeApi(() => ({
  console: {
    datasets: {
      byDatasetId: {
        knowledgeFsUpgrades: {
          get: () => ({
            can_retry: false,
            can_upgrade: true,
            job: null,
            models: recommendedModels,
          }),
          post: () => job,
          byJobId: { get: () => new Promise(() => {}) },
        },
      },
    },
    workspaces: {
      current: {
        models: {
          modelTypes: {
            byModelType: {
              get: ({ params }) => ({
                data: modelCatalogs
                  .map((provider) => ({
                    ...provider,
                    models: provider.models.filter(
                      (model) => model.model_type === params.model_type,
                    ),
                  }))
                  .filter((provider) => provider.models.length),
              }),
            },
          },
        },
      },
    },
  },
}))

// Exercise dialog callbacks through their production owner: cancel removes it and start adds a card.
function UpgradeOwner() {
  const { requestUpgrade, settleUpgrade, upgrades } = useKnowledgeUpgrade()
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => requestUpgrade(dataset, triggerRef)}>
        Upgrade support knowledge
      </button>
      <ul aria-label="Upgrades" className="w-80">
        {upgrades.map((upgrade) => (
          <KnowledgeUpgradeCard key={upgrade.job.id} upgrade={upgrade} onSettled={settleUpgrade} />
        ))}
      </ul>
    </>
  )
}
async function renderDialog() {
  // The app's cache-level error toasts, so a failure's messages can be counted.
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    queryClient: createConsoleQueryClient({ caches: createErrorToastCaches() }),
  })
  seedUpgradeModels(queryClient)
  await render(
    <QueryProvider>
      <QueryTestingAdapter>
        <KnowledgeUpgradeProvider onUpgradeStarted={() => {}}>
          <UpgradeOwner />
        </KnowledgeUpgradeProvider>
      </QueryTestingAdapter>
      <AppToaster />
    </QueryProvider>,
  )
  await page.getByRole('button', { name: 'Upgrade support knowledge' }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
}
const startButton = () =>
  page.getByRole('button', { name: 'knowledgeUpgrade.upgrade.start', exact: true })
const reasoningSelector = () =>
  page.getByRole('button', { name: /knowledgeSettings.settings.systemReasoningModelLabel/ })
async function waitForRecommendedModels() {
  await expect.element(reasoningSelector().getByText('gpt-4o', { exact: true })).toBeVisible()
  await expect.element(startButton()).toBeEnabled()
}

async function expectStarted() {
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect
    .element(
      page.getByRole('list', { name: 'Upgrades' }).getByText('Support knowledge', { exact: true }),
    )
    .toBeVisible()
  await expect
    .element(page.getByText('knowledgeUpgrade.upgrade.statusUpgrading', { exact: true }))
    .toBeVisible()
}
describe('KnowledgeUpgradeDialog', () => {
  beforeEach(async () => {
    await page.viewport(640, 600)
  })

  it('offers upgrade details and documentation before requiring an explicit confirmation', async () => {
    await renderDialog()

    await expect.element(page.getByText('knowledgeUpgrade.upgrade.dialogDuration')).toBeVisible()
    await expect.element(page.getByText('knowledgeUpgrade.upgrade.dialogLinkedApps')).toBeVisible()
    const learnMore = page.getByRole('link', { name: 'knowledgeSpace.learnMore' })
    await expect
      .element(learnMore)
      .toHaveAttribute(
        'href',
        expect.stringMatching(/\/use-dify\/knowledge-base\/upgrade-from-classic$/),
      )
    await expect.element(learnMore).toHaveAttribute('target', '_blank')
    await expect.element(page.getByText(/knowledgeUpgrade\.upgrade\.summary/)).toBeVisible()
    await expect
      .element(
        page
          .getByRole('region', { name: 'knowledgeSpace.modelCost.title' })
          .getByText('knowledgeUpgrade.upgrade.modelCostDescription', { exact: true }),
      )
      .toBeVisible()
    // Vitest's description matcher drops the body of a labelled region here, whereas
    // Chromium's accessibility tree includes it. Verify the public ARIA reference and its
    // visible cost content without encoding that matcher artifact as a product defect.
    await expect.element(startButton()).toHaveAttribute('aria-describedby')
    const descriptionId = startButton().element().getAttribute('aria-describedby')!
    const description = document.getElementById(descriptionId)
    await expect
      .element(description)
      .toMatchTextContent('knowledgeUpgrade.upgrade.modelCostDescription')
    await waitForRecommendedModels()
    expect(fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post).not.toHaveBeenCalled()

    await page.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Upgrade support knowledge' }))
      .toHaveFocus()
    expect(fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post).not.toHaveBeenCalled()
  })

  it('prefills recommended models and sends them with the upgrade request', async () => {
    fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post.mockResolvedValue(job)
    await renderDialog()

    await expect
      .element(
        page.getByRole('button', {
          name: /knowledgeSettings.settings.embeddingModelLabel.*text-embedding-3-small/,
        }),
      )
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('region', { name: 'knowledgeCreate.modelSettings' }))
      .toBeInTheDocument()
    await startButton().click()

    await expectStarted()
    expect(fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post).toHaveBeenCalledWith({
      body: { models: expectedPayload },
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { dataset_id: datasetId },
    })
  })

  it('requires a choice when a recommended model is unavailable', async () => {
    fake.console.datasets.byDatasetId.knowledgeFsUpgrades.get.mockResolvedValue({
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
    fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post.mockResolvedValue(job)
    await renderDialog()

    await expect
      .element(page.getByText('knowledgeSettings.settings.systemReasoningModelRequired'))
      .toBeVisible()
    await expect.element(reasoningSelector()).not.toMatchTextContent('retired-model')
    await expect.element(startButton()).toBeDisabled()

    await reasoningSelector().click()
    await page.getByRole('button', { name: 'gpt-4o-mini' }).click()
    await expect.element(startButton()).toBeEnabled()
    await startButton().click()

    await expect
      .poll(() => fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post.mock.calls.at(-1)?.[0])
      .toEqual(
        expect.objectContaining({
          body: {
            models: {
              ...expectedPayload,
              reasoning: { model: 'gpt-4o-mini', provider: 'langgenius/openai/openai' },
            },
          },
        }),
      )
    await expectStarted()
  })

  it('shows a failed upgrade check once, with the translated reason in the dialog', async () => {
    fake.console.datasets.byDatasetId.knowledgeFsUpgrades.get.mockRejectedValue(
      apiError({
        status: 503,
        code: 'knowledge_fs_space_not_found',
        message: 'Upgrade check is unavailable',
      }),
    )
    await renderDialog()

    const reason = 'requestErrors.code.knowledge_fs_space_not_found'
    await expect.element(page.getByRole('alert')).toHaveTextContent(reason)
    expect(page.getByText(reason).elements()).toHaveLength(1)
  })

  it('reuses the idempotency key for retries and rotates it when the model choice changes', async () => {
    fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post
      .mockRejectedValueOnce(
        apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'response lost' }),
      )
      .mockRejectedValueOnce(
        apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'response lost' }),
      )
      .mockResolvedValueOnce(job)
    await renderDialog()

    await waitForRecommendedModels()
    await startButton().click()
    // The dialog shows its own text once for an uncataloged code; the cache adds no toast for it.
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('knowledgeUpgrade.upgrade.startFailed')
    expect(page.getByText('knowledgeUpgrade.upgrade.startFailed').elements()).toHaveLength(1)
    await startButton().click()
    await expect
      .poll(() => fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post.mock.calls.length)
      .toBe(2)

    await reasoningSelector().click()
    await page.getByRole('button', { name: 'gpt-4o-mini' }).click()
    await startButton().click()

    await expectStarted()
    const keys = fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post.mock.calls.map(
      ([input]) => input.headers['Idempotency-Key'],
    )
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
    expect(fake.console.datasets.byDatasetId.knowledgeFsUpgrades.get).toHaveBeenCalledWith({
      params: { dataset_id: datasetId },
    })
  })

  it('keeps the dialog open and marks rejected models when the backend reports them unavailable', async () => {
    fake.console.datasets.byDatasetId.knowledgeFsUpgrades.post.mockRejectedValueOnce(
      apiError({
        status: 422,
        code: 'knowledge_fs_upgrade_models_unavailable',
        message: 'Models unavailable',
        details: {
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
    await renderDialog()

    await waitForRecommendedModels()
    fake.console.workspaces.current.models.modelTypes.byModelType.get.mockClear()
    await startButton().click()

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('knowledgeUpgrade.upgrade.modelsUnavailable')
    await expect
      .element(reasoningSelector())
      .toHaveAccessibleDescription(expect.stringContaining('knowledgeCreate.modelUnavailable'))
    await expect.element(startButton()).toBeDisabled()
    await expect
      .poll(() =>
        fake.console.workspaces.current.models.modelTypes.byModelType.get.mock.calls.map(
          ([input]) => input,
        ),
      )
      .toContainEqual({ params: { model_type: 'llm' } })

    await reasoningSelector().click()
    await page.getByRole('button', { name: 'gpt-4o-mini' }).click()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect
      .element(reasoningSelector())
      .not.toHaveAccessibleDescription(expect.stringContaining('knowledgeCreate.modelUnavailable'))
    await expect.element(startButton()).toBeEnabled()
  })
})
