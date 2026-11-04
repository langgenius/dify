import type { RetrievalConfig } from '@/types/app'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DEFAULT_WEIGHTED_SCORE, RerankingModeEnum, WeightedScoreEnum } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { RETRIEVE_METHOD } from '@/types/app'
import RetrievalMethodConfig from '../index'

let validDefault = true

const config = (overrides: Partial<RetrievalConfig> = {}): RetrievalConfig => ({
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0.5,
  ...overrides,
})
const methods = [RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.fullText, RETRIEVE_METHOD.hybrid]
const radioName = (method: RETRIEVE_METHOD) => `dataset.retrieval.${method}.title`
const weights = {
  weight_type: WeightedScoreEnum.Customized,
  vector_setting: {
    vector_weight: DEFAULT_WEIGHTED_SCORE.other.semantic,
    embedding_provider_name: '',
    embedding_model_name: '',
  },
  keyword_setting: { keyword_weight: DEFAULT_WEIGHTED_SCORE.other.keyword },
}
const render = createNuqsTestRenderer((ui: React.ReactElement, supported: string[] = methods) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(
    queryClient,
    validDefault
      ? [
          createModelCatalogFixture({
            provider: 'provider',
            models: [createCatalogModelFixture({ model: 'reranker', model_type: 'rerank' })],
          }),
        ]
      : [],
  )
  if (validDefault) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type: 'rerank' } },
      }),
      {
        data: createDefaultModelFixture({
          provider: { provider: 'provider' },
          model: 'reranker',
          model_type: 'rerank',
        }),
      },
    )
  }
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryOptions().queryKey, {
    retrieval_method: supported,
  })
  return renderWithConsoleQuery(ui, { queryClient })
})
beforeEach(() => {
  validDefault = true
})

it('keeps numeric parameter interaction outside retrieval mode selection', async () => {
  const user = userEvent.setup()
  function Owner() {
    const [value, onChange] = useState(config())
    return <RetrievalMethodConfig value={value} onChange={onChange} />
  }
  render(<Owner />)
  const semantic = screen.getByRole('radio', { name: radioName(RETRIEVE_METHOD.semantic) })
  expect(semantic).toBeChecked()
  expect(semantic).not.toContainElement(
    screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }),
  )
  semantic.focus()
  await user.keyboard('{ArrowDown}')
  const fullText = screen.getByRole('radio', { name: radioName(RETRIEVE_METHOD.fullText) })
  expect(fullText).toBeChecked()
  expect(fullText).toHaveFocus()
  const topK = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  await user.click(topK)
  await user.keyboard('{ArrowUp}')
  expect(topK).toHaveValue('5')
  expect(fullText).toBeChecked()
  expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1)
})

it.each(methods.flatMap((method) => [true, false].map((valid) => ({ method, valid }))))(
  'selects $method with a valid default reranker: $valid',
  async ({ method, valid }) => {
    const user = userEvent.setup()
    validDefault = valid
    const onChange = vi.fn()
    const value = config({
      search_method:
        method === RETRIEVE_METHOD.semantic ? RETRIEVE_METHOD.fullText : RETRIEVE_METHOD.semantic,
    })
    render(<RetrievalMethodConfig value={value} onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: radioName(method) }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...value,
      search_method: method,
      reranking_enable: valid,
      reranking_model: {
        reranking_provider_name: valid ? 'provider' : '',
        reranking_model_name: valid ? 'reranker' : '',
      },
      ...(method === RETRIEVE_METHOD.hybrid
        ? {
            weights,
            reranking_mode: valid
              ? RerankingModeEnum.RerankingModel
              : RerankingModeEnum.WeightedScore,
          }
        : {}),
    })
  },
)

it('preserves explicitly selected models and weights when switching to hybrid search', async () => {
  const user = userEvent.setup()
  validDefault = false
  const onChange = vi.fn()
  const value = config({
    reranking_model: {
      reranking_provider_name: 'chosen-provider',
      reranking_model_name: 'chosen-model',
    },
    weights: {
      ...weights,
      vector_setting: { ...weights.vector_setting, vector_weight: 0.8 },
      keyword_setting: { keyword_weight: 0.2 },
    },
  })
  render(<RetrievalMethodConfig value={value} onChange={onChange} />)
  await user.click(screen.getByRole('radio', { name: radioName(RETRIEVE_METHOD.hybrid) }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    ...value,
    search_method: RETRIEVE_METHOD.hybrid,
    reranking_enable: true,
    reranking_mode: RerankingModeEnum.RerankingModel,
  })
})

it('offers only supported retrieval methods and ignores unknown API values', () => {
  render(<RetrievalMethodConfig value={config()} onChange={vi.fn()} />, [
    RETRIEVE_METHOD.semantic,
    'future-method',
  ])
  expect(screen.getAllByRole('radio')).toHaveLength(1)
  expect(screen.getByRole('radio', { name: radioName(RETRIEVE_METHOD.semantic) })).toBeChecked()
})

it('disables both mode selection and numeric editing when readonly', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<RetrievalMethodConfig value={config()} onChange={onChange} disabled />)
  const fullText = screen.getByRole('radio', { name: radioName(RETRIEVE_METHOD.fullText) })
  expect(fullText).toBeDisabled()
  expect(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })).toBeDisabled()
  await user.click(fullText)
  expect(onChange).not.toHaveBeenCalled()
})
