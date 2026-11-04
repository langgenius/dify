import type { KnowledgeFsUpgradePreparationResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { ORPCError } from '@orpc/client'
import { useRef } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import {
  upgradeDataset as dataset,
  expectedUpgradeModels as expectedPayload,
  upgradeJob as job,
  upgradeModelCatalogs as modelCatalogs,
  recommendedUpgradeModels as recommendedModels,
  seedUpgradeModels,
} from '@/test/new-rag-upgrade'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { KnowledgeUpgradeCard } from '../knowledge-upgrade-card'
import { KnowledgeUpgradeProvider } from '../knowledge-upgrade-context'
import { useKnowledgeUpgrade } from '../knowledge-upgrade-context-value'

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
      'datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get': () => new Promise(() => {}),
    }),
  }
})

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
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
  seedUpgradeModels(queryClient)
  await render(
    <QueryProvider>
      <QueryTestingAdapter>
        <KnowledgeUpgradeProvider onUpgradeStarted={() => {}}>
          <UpgradeOwner />
        </KnowledgeUpgradeProvider>
      </QueryTestingAdapter>
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
  beforeEach(async ({ onTestFinished }) => {
    onTestFinished(guardUnexpectedFetch())
    await page.viewport(640, 600)
    startUpgradeMock.mockReset().mockResolvedValue(job)
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
    expect(startUpgradeMock).not.toHaveBeenCalled()

    await page.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Upgrade support knowledge' }))
      .toHaveFocus()
    expect(startUpgradeMock).not.toHaveBeenCalled()
  })

  it('prefills recommended models and sends them with the upgrade request', async () => {
    startUpgradeMock.mockResolvedValue(job)
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
      .poll(() => startUpgradeMock.mock.calls.at(-1)?.[0])
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

  it('reuses the idempotency key for retries and rotates it when the model choice changes', async () => {
    startUpgradeMock
      .mockRejectedValueOnce(new Error('response lost'))
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(job)
    await renderDialog()

    await waitForRecommendedModels()
    await startButton().click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('knowledgeUpgrade.upgrade.startFailed')
    await startButton().click()
    await expect.poll(() => startUpgradeMock.mock.calls.length).toBe(2)

    await reasoningSelector().click()
    await page.getByRole('button', { name: 'gpt-4o-mini' }).click()
    await startButton().click()

    await expectStarted()
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
    await renderDialog()

    await waitForRecommendedModels()
    getModelsMock.mockClear()
    await startButton().click()

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('knowledgeUpgrade.upgrade.modelsUnavailable')
    await expect
      .element(reasoningSelector())
      .toHaveAccessibleDescription(expect.stringContaining('knowledgeCreate.modelUnavailable'))
    await expect.element(startButton()).toBeDisabled()
    await expect
      .poll(() => getModelsMock.mock.calls.map(([input]) => input))
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
