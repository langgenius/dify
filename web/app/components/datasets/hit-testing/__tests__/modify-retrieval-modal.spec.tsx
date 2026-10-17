import type { RetrievalConfig } from '@/types/app'
import { Drawer } from '@langgenius/dify-ui/drawer'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { RETRIEVE_METHOD } from '@/types/app'
import ModifyRetrievalModal from '../modify-retrieval-modal'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', () => ({ toast: { error: toastError } }))
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: {
      dataset: { embedding_model: string; embedding_model_provider: string }
    }) => unknown,
  ) => selector({ dataset: { embedding_model: '', embedding_model_provider: '' } }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { createModelCreditsFixture } = await import('@/test/console/model-provider')
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.models.modelTypes.byModelType.get': async () => ({ data: [] }),
      'workspaces.current.modelProviders.credits.get': async () => createModelCreditsFixture(),
      'workspaces.current.defaultModel.get': async () => ({ data: null }),
      'datasets.retrievalSetting.get': async () => ({
        retrieval_method: ['semantic_search', 'full_text_search', 'hybrid_search'],
      }),
    }),
  }
})
const value: RetrievalConfig = {
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
  top_k: 3,
  score_threshold: 0.5,
  score_threshold_enabled: false,
}
const show = (overrides: Partial<Parameters<typeof ModifyRetrievalModal>[0]> = {}) => {
  const props = {
    indexMethod: 'high_quality',
    value,
    isShow: true,
    onHide: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  }
  return {
    ...props,
    ...renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <Drawer open>
          <ModifyRetrievalModal {...props} />
        </Drawer>
      </NuqsTestingAdapter>,
    ),
  }
}

it.each(['high_quality', 'economy'])(
  'saves edited retrieval parameters for %s',
  async (indexMethod) => {
    const user = userEvent.setup()
    const { onSave } = show({ indexMethod })
    const topK = await screen.findByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
    await user.clear(topK)
    await user.type(topK, '8')
    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ ...value, top_k: 8 })
  },
)

it.each(['cancel', 'close'])('discards edits through %s', async (action) => {
  const user = userEvent.setup()
  const { onHide, onSave } = show()
  await user.type(await screen.findByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }), '0')
  await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
  expect(onHide).toHaveBeenCalledOnce()
  expect(onSave).not.toHaveBeenCalled()
})

it('rejects saving reranking without an available model', async () => {
  const user = userEvent.setup()
  const { onSave } = show({ value: { ...value, reranking_enable: true } })
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(toastError).toHaveBeenCalledWith('appDebug.datasetConfig.rerankModelRequired')
  expect(onSave).not.toHaveBeenCalled()
})
