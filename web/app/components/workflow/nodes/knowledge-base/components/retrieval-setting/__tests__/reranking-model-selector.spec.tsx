import type { RerankingModel } from '../../../types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  createModel,
  createModelItem,
} from '@/app/components/workflow/__tests__/model-provider-fixtures'
import { consoleQuery } from '@/service/console'
import {
  createModelCreditsFixture,
  createProviderSummaryFixture,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import RerankingModelSelector from '../reranking-model-selector'

const modelList = [
  createModel({
    provider: 'cohere',
    label: { en_US: 'Cohere', zh_Hans: 'Cohere' },
    models: [
      createModelItem({
        model: 'rerank-v3',
        model_type: ModelTypeEnum.rerank,
        label: { en_US: 'Rerank V3', zh_Hans: 'Rerank V3' },
      }),
    ],
  }),
]

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/hooks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/header/account-setting/model-provider-page/hooks')
    >()),
    useModelListAndDefaultModel: () => ({ modelList, defaultModel: undefined }),
  }),
)

it('selects a real rerank model and preserves the workflow field mapping on reopening', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { queryClient, wrapper } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: false },
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: [
      createProviderSummaryFixture({
        provider: 'cohere',
        label: { en_US: 'Cohere' },
        supported_model_types: ['rerank'],
        custom_configuration: { current_credential_usable: true },
      }),
    ],
    plugins: {},
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
    createModelCreditsFixture(),
  )
  for (const model_type of ['llm', 'text-embedding', 'rerank', 'speech2text', 'tts'] as const) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type } },
      }),
      { data: [] },
    )
  }
  function Picker() {
    const [model, setModel] = useState<RerankingModel>({
      reranking_provider_name: '',
      reranking_model_name: '',
    })
    return (
      <RerankingModelSelector
        rerankingModel={model}
        onRerankingModelChange={(next) => {
          onChange(next)
          setModel(next)
        }}
      />
    )
  }
  render(
    <NuqsTestingAdapter>
      <Picker />
    </NuqsTestingAdapter>,
    { wrapper },
  )
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: /Rerank V3/ }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    reranking_provider_name: 'cohere',
    reranking_model_name: 'rerank-v3',
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Rerank V3/ }))
  expect(
    within(await screen.findByRole('dialog')).getByRole('button', { name: /Rerank V3/ }),
  ).toHaveAttribute('aria-current', 'true')
})
