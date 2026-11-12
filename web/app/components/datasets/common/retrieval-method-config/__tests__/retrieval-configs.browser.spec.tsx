import type { RetrievalConfig } from '@/types/app'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { DEFAULT_WEIGHTED_SCORE, RerankingModeEnum, WeightedScoreEnum } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { RETRIEVE_METHOD } from '@/types/app'
import EconomicalRetrievalMethodConfig from '../../economical-retrieval-method-config'
import RetrievalMethodConfig from '../index'

const methods = [RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.fullText, RETRIEVE_METHOD.hybrid]
const methodName = (method: RETRIEVE_METHOD) => `dataset.retrieval.${method}.title`
const defaultWeights = {
  weight_type: WeightedScoreEnum.Customized,
  vector_setting: {
    vector_weight: DEFAULT_WEIGHTED_SCORE.other.semantic,
    embedding_provider_name: '',
    embedding_model_name: '',
  },
  keyword_setting: { keyword_weight: DEFAULT_WEIGHTED_SCORE.other.keyword },
}

const config = (overrides: Partial<RetrievalConfig> = {}): RetrievalConfig => ({
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: true,
  reranking_model: {
    reranking_provider_name: 'rerank-provider',
    reranking_model_name: 'rerank-model',
  },
  top_k: 5,
  score_threshold_enabled: true,
  score_threshold: 0.5,
  reranking_mode: RerankingModeEnum.RerankingModel,
  ...overrides,
})

function RetrievalOwner({
  initial,
  disabled = false,
  economical = false,
  showMultiModalTip = false,
}: {
  initial: RetrievalConfig
  disabled?: boolean
  economical?: boolean
  showMultiModalTip?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      {economical ? (
        <EconomicalRetrievalMethodConfig value={value} onChange={setValue} disabled={disabled} />
      ) : (
        <RetrievalMethodConfig
          value={value}
          onChange={setValue}
          disabled={disabled}
          showMultiModalTip={showMultiModalTip}
        />
      )}
      <output aria-label="Saved retrieval configuration">{JSON.stringify(value)}</output>
    </>
  )
}

function saved(screen: Awaited<ReturnType<typeof render>>) {
  return JSON.parse(
    screen.getByRole('status', { name: 'Saved retrieval configuration' }).element().textContent!,
  ) as RetrievalConfig
}

async function renderRetrieval({
  initial = config(),
  modelAvailable = true,
  supported = methods,
  ...ownerProps
}: {
  initial?: RetrievalConfig
  modelAvailable?: boolean
  supported?: string[]
  disabled?: boolean
  economical?: boolean
  showMultiModalTip?: boolean
} = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(
    queryClient,
    modelAvailable
      ? [
          createModelCatalogFixture({
            provider: 'rerank-provider',
            models: [
              createCatalogModelFixture({
                model: 'rerank-model',
                label: { en_US: 'Rerank Model' },
                model_type: 'rerank',
              }),
            ],
          }),
          createModelCatalogFixture({
            provider: 'new-provider',
            models: [
              createCatalogModelFixture({
                model: 'new-model',
                label: { en_US: 'New Model' },
                model_type: 'rerank',
              }),
            ],
          }),
        ]
      : [],
  )
  if (modelAvailable) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type: 'rerank' } },
      }),
      {
        data: createDefaultModelFixture({
          provider: { provider: 'rerank-provider' },
          model: 'rerank-model',
          model_type: 'rerank',
        }),
      },
    )
  }
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryOptions().queryKey, {
    retrieval_method: supported,
  })
  const { wrapper: ConsoleQuery } = createConsoleQueryWrapper({ queryClient })
  return render(
    <ConsoleQuery>
      <NuqsTestingAdapter>
        <AppToaster timeout={0} />
        <RetrievalOwner initial={initial} {...ownerProps} />
      </NuqsTestingAdapter>
    </ConsoleQuery>,
  )
}

afterEach(() => toast.dismiss())

it('applies semantic controls to the live caller instead of emitting stale snapshots', async () => {
  const screen = await renderRetrieval({ showMultiModalTip: true })
  const rerank = screen.getByRole('switch', {
    name: 'modelProvider.modelProvider.rerankModel.key',
  })

  await expect.element(screen.getByRole('button', { name: /Rerank Model/ })).toBeVisible()
  await expect
    .element(screen.getByText('datasetSettings.form.retrievalSetting.multiModalTip'))
    .toBeVisible()
  await rerank.click()
  await expect.element(rerank).not.toBeChecked()
  await expect.element(screen.getByRole('button', { name: /Rerank Model/ })).not.toBeInTheDocument()
  expect(saved(screen).reranking_enable).toBe(false)

  await rerank.click()
  await screen.getByRole('button', { name: /Rerank Model/ }).click()
  await screen.getByRole('button', { name: /New Model/ }).click()
  await expect.element(screen.getByRole('button', { name: /New Model/ })).toBeVisible()

  const topK = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  await topK.click()
  await userEvent.keyboard('{ArrowUp}')
  const threshold = screen.getByRole('textbox', {
    name: 'appDebug.datasetConfig.score_threshold',
  })
  await threshold.click()
  await userEvent.keyboard('{ArrowUp}')
  await screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }).click()

  await expect.element(topK).toHaveValue('6')
  await expect.element(threshold).toHaveValue('0.51')
  expect(saved(screen)).toMatchObject({
    reranking_model: {
      reranking_provider_name: 'new-provider',
      reranking_model_name: 'new-model',
    },
    top_k: 6,
    score_threshold: 0.51,
    score_threshold_enabled: false,
  })
})

it('initializes hybrid defaults and keeps both controls synchronized after native input', async () => {
  const screen = await renderRetrieval({
    initial: config({
      search_method: RETRIEVE_METHOD.fullText,
      reranking_enable: false,
      reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
      weights: undefined,
    }),
    showMultiModalTip: true,
  })

  await screen.getByRole('radio', { name: methodName(RETRIEVE_METHOD.hybrid) }).click()
  await expect
    .element(screen.getByRole('radio', { name: methodName(RETRIEVE_METHOD.hybrid) }))
    .toBeChecked()
  expect(saved(screen)).toMatchObject({
    search_method: RETRIEVE_METHOD.hybrid,
    reranking_enable: true,
    reranking_mode: RerankingModeEnum.RerankingModel,
    reranking_model: {
      reranking_provider_name: 'rerank-provider',
      reranking_model_name: 'rerank-model',
    },
    weights: defaultWeights,
  })
  await expect
    .element(screen.getByText('datasetSettings.form.retrievalSetting.multiModalTip'))
    .toBeVisible()

  await screen.getByRole('radio', { name: /dataset\.weightedScore\.title/ }).click()
  const slider = screen.getByRole('slider', { name: 'dataset.weightedScore.semantic' })
  await expect.element(slider).toBeVisible()
  await expect
    .element(screen.getByText('datasetSettings.form.retrievalSetting.multiModalTip'))
    .not.toBeInTheDocument()
  slider.element().focus()
  await userEvent.keyboard('{ArrowLeft}')
  expect(saved(screen)).toMatchObject({
    reranking_mode: RerankingModeEnum.WeightedScore,
    weights: {
      vector_setting: { vector_weight: 0.6 },
      keyword_setting: { keyword_weight: 0.4 },
    },
  })
})

it('preserves explicit model and weight choices across method changes', async () => {
  const existingWeights = {
    ...defaultWeights,
    vector_setting: {
      ...defaultWeights.vector_setting,
      vector_weight: 0.8,
      embedding_provider_name: 'embedding-provider',
      embedding_model_name: 'embedding-model',
    },
    keyword_setting: { keyword_weight: 0.2 },
  }
  const screen = await renderRetrieval({
    initial: config({
      search_method: RETRIEVE_METHOD.semantic,
      weights: existingWeights,
    }),
  })

  await screen.getByRole('radio', { name: methodName(RETRIEVE_METHOD.hybrid) }).click()
  await screen.getByRole('radio', { name: /dataset\.weightedScore\.title/ }).click()

  expect(saved(screen)).toMatchObject({
    search_method: RETRIEVE_METHOD.hybrid,
    reranking_mode: RerankingModeEnum.WeightedScore,
    weights: existingWeights,
  })
})

it('falls back to weighted hybrid retrieval and reports an unavailable reranker', async () => {
  const screen = await renderRetrieval({
    modelAvailable: false,
    initial: config({
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: false,
      reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
      weights: undefined,
    }),
  })

  await screen.getByRole('radio', { name: methodName(RETRIEVE_METHOD.hybrid) }).click()
  expect(saved(screen)).toMatchObject({
    reranking_enable: false,
    reranking_mode: RerankingModeEnum.WeightedScore,
    weights: defaultWeights,
  })

  await screen
    .getByRole('radio', { name: /modelProvider\.modelProvider\.rerankModel\.key/ })
    .click()
  await expect.element(screen.getByText('workflow.errorMsg.rerankModelRequired')).toBeVisible()
  expect(saved(screen).reranking_mode).toBe(RerankingModeEnum.RerankingModel)
})

it('keeps economical retrieval within its public control set', async () => {
  const economical = await renderRetrieval({ economical: true })
  await expect
    .element(
      economical.getByRole('switch', { name: 'modelProvider.modelProvider.rerankModel.key' }),
    )
    .not.toBeInTheDocument()
  await expect
    .element(economical.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }))
    .not.toBeInTheDocument()
  const topK = economical.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  await topK.click()
  await userEvent.keyboard('{ArrowUp}')
  await expect.element(topK).toHaveValue('6')
  expect(saved(economical).top_k).toBe(6)
})

it('disables both method selection and numeric editing in readonly mode', async () => {
  const screen = await renderRetrieval({ disabled: true })
  await expect
    .element(screen.getByRole('radio', { name: methodName(RETRIEVE_METHOD.fullText) }))
    .toBeDisabled()
  await expect
    .element(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }))
    .toBeDisabled()
})

it('renders only retrieval methods supported by the service contract', async () => {
  const screen = await renderRetrieval({ supported: [RETRIEVE_METHOD.semantic, 'future-method'] })

  await expect.poll(() => screen.getByRole('radio').elements().length).toBe(1)
  await expect
    .element(screen.getByRole('radio', { name: methodName(RETRIEVE_METHOD.semantic) }))
    .toBeChecked()
})
