import type { RetrievalConfig } from '@/types/app'
import { Drawer } from '@langgenius/dify-ui/drawer'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import DatasetDetailContext from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import ModifyRetrievalModal from '../modify-retrieval-modal'

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
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryKey(), {
    retrieval_method: ['semantic_search', 'full_text_search', 'hybrid_search'],
  })
  return {
    ...props,
    ...renderWithConsoleQuery(
      <NuqsTestingAdapter>
        {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component. */}
        <DatasetDetailContext.Provider value={{ dataset: createDatasetFixture() }}>
          <Drawer open>
            <ModifyRetrievalModal {...props} />
          </Drawer>
          <AppToastHost />
        </DatasetDetailContext.Provider>
      </NuqsTestingAdapter>,
      { queryClient },
    ),
  }
}

afterEach(async () => {
  await act(async () => toast.dismiss())
})

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
  expect(await screen.findByText('appDebug.datasetConfig.rerankModelRequired')).toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()
})
