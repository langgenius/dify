import type { DocumentDetailResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { StepTwoProps } from '@/app/components/datasets/create/step-two/types'
import { act, screen, waitFor } from '@testing-library/react'
import { IndexingType } from '@/app/components/datasets/create/step-two/hooks/use-indexing-config'
import DatasetDetailContext from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import DocumentSettings from '../document-settings'

const { getDocument, title, push, back, renderStepTwo } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  title: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  renderStepTwo: vi.fn(),
}))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push, back }) }))
vi.mock('@/hooks/use-document-title', () => ({ default: title }))
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({ data: { model: 'text-embedding-ada-002' } }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.get': getDocument,
    }),
  }
})
// The indexing form has its own interaction suite. Here its typed boundary exposes stored-source conversion and completion effects.
vi.mock('@/app/components/datasets/create/step-two', () => ({
  default: (props: StepTwoProps) => {
    renderStepTwo(props)
    return null
  },
}))

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithConsoleQuery, () => ({ onUrlUpdate }))
const params = { dataset_id: 'dataset-1', document_id: 'document-1' }
function setup() {
  const queryClient = createConsoleQueryClient()
  const listKey = consoleQuery.datasets.byDatasetId.documents.get.queryKey({
    input: { params: { dataset_id: 'dataset-1' } },
  })
  queryClient.setQueryData(listKey, { data: [], total: 0, page: 1, limit: 10, has_more: false })
  render(
    <DatasetDetailContext.Provider
      value={{
        indexingTechnique: IndexingType.QUALIFIED,
        dataset: createDatasetFixture({ id: 'dataset-1', name: 'Dataset 1' }),
      }}
    >
      <DocumentSettings datasetId="dataset-1" documentId="document-1" />
    </DatasetDetailContext.Provider>,
    { queryClient },
  )
  return { queryClient, listKey }
}
const document: DocumentDetailResponse = {
  id: 'document-1',
  name: 'Guide.pdf',
  data_source_type: 'upload_file',
  data_source_info: { upload_file_id: 'file-1' },
}
const formProps = (): StepTwoProps => renderStepTwo.mock.lastCall![0]
beforeEach(() => {
  vi.clearAllMocks()
  getDocument.mockReset().mockResolvedValue(document)
})

it.each([
  [{ upload_file_id: 'file-1' }, { id: 'file-1', name: 'Guide.pdf' }],
  [
    { upload_file: { id: 'legacy-1', name: 'Original.txt', extension: 'txt' } },
    { id: 'legacy-1', name: 'Original.txt', extension: 'txt' },
  ],
  [
    { related_id: 'local-1', transfer_method: 'local', name: 'Local.pdf', extension: 'pdf' },
    { id: 'local-1', name: 'Local.pdf', extension: 'pdf' },
  ],
])(
  'preserves file identity and name when restoring stored source %j',
  async (data_source_info, file) => {
    getDocument.mockResolvedValue({ ...document, data_source_info })
    setup()
    await waitFor(() => expect(renderStepTwo).toHaveBeenCalled())
    expect(formProps().files).toEqual([file])
    expect(getDocument).toHaveBeenCalledWith({ params, query: { metadata: 'without' } })
    expect(title).toHaveBeenLastCalledWith(
      'datasetPipeline.documentSettings.title · Guide.pdf · Dataset 1',
    )
  },
)

it('refreshes cached documents and returns to the owning document after a successful save', async () => {
  const { queryClient, listKey } = setup()
  await waitFor(() => expect(renderStepTwo).toHaveBeenCalled())
  const requestsBeforeSave = getDocument.mock.calls.length
  act(() => formProps().onSave!())
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
  await waitFor(() => expect(getDocument.mock.calls.length).toBeGreaterThan(requestsBeforeSave))
  expect(push).toHaveBeenCalledWith('/datasets/dataset-1/documents/document-1')
})

it('opens provider settings and leaves the draft without saving when canceled', async () => {
  const { queryClient, listKey } = setup()
  await waitFor(() => expect(renderStepTwo).toHaveBeenCalled())
  act(() => formProps().onSetting())
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get('settings')).toBe('provider'),
  )
  act(() => formProps().onCancel!())
  expect(back).toHaveBeenCalledOnce()
  expect(push).not.toHaveBeenCalled()
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false)
})

it('withholds the form while fetching and shows the load failure', async () => {
  getDocument.mockRejectedValue(new Error('Unavailable'))
  setup()
  expect(renderStepTwo).not.toHaveBeenCalled()
  expect(await screen.findByText('datasetCreation.error.unavailable')).toBeInTheDocument()
  expect(renderStepTwo).not.toHaveBeenCalled()
})
