import type { ComponentProps } from 'react'
import type ImageUploader from '@/app/components/datasets/common/image-uploader/image-uploader-in-chunk'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { IndexingType } from '../../../create/step-two'
import NewSegmentModal from '../new-segment'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({
    datasetId: 'test-dataset-id',
    documentId: 'test-document-id',
  }),
}))

const toastErrorSpy = vi.spyOn(toast, 'error')
const toastSuccessSpy = vi.spyOn(toast, 'success')

// Mock dataset detail context
let mockIndexingTechnique: IndexingType = IndexingType.QUALIFIED
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: { indexing_technique: string } }) => unknown,
  ) => {
    return selector({ dataset: { indexing_technique: mockIndexingTechnique } })
  },
}))

// Mock segment list context
let mockFullScreen = false
const mockToggleFullScreen = vi.fn()
vi.mock('../completed', () => ({
  useSegmentListContext: (
    selector: (state: { fullScreen: boolean; toggleFullScreen: () => void }) => unknown,
  ) => {
    const state = {
      fullScreen: mockFullScreen,
      toggleFullScreen: mockToggleFullScreen,
    }
    return selector(state)
  },
}))

// Mock useAddSegment
const mockAddSegment = vi.fn()
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.segment.post': (input) => mockAddSegment(input),
    }),
  }
})

let mockDocForm: ChunkingMode = ChunkingMode.text
vi.mock('../context', () => ({
  useDocumentContext: (
    selector: (state: { docForm: ChunkingMode; parentMode: string }) => unknown,
  ) => selector({ docForm: mockDocForm, parentMode: 'paragraph' }),
}))
// The uploader's upload interactions are covered by its own suite.
let uploaderProps: ComponentProps<typeof ImageUploader>
vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-chunk', () => ({
  default: (props: ComponentProps<typeof ImageUploader>) => {
    uploaderProps = props
    return null
  },
}))
const props = {
  onCancel: vi.fn(),
  docForm: ChunkingMode.text,
  onSave: vi.fn(),
  viewNewlyAddedChunk: vi.fn(),
}
const save = () => screen.getByRole('button', { name: /common.operation.save/ })
const content = () =>
  screen.getByRole('textbox', { name: 'datasetDocuments.segment.contentPlaceholder' })
beforeEach(() => {
  toast.dismiss()
  mockFullScreen = false
  mockIndexingTechnique = IndexingType.QUALIFIED
  mockDocForm = ChunkingMode.text
  mockAddSegment.mockReset().mockResolvedValue({ data: [] })
})
afterEach(() => toast.dismiss())

it.each([
  [ChunkingMode.text, '', 'contentEmpty'],
  [ChunkingMode.qa, '', 'questionEmpty'],
  [ChunkingMode.qa, 'Question', 'answerEmpty'],
])('rejects incomplete %s content (%s)', async (docForm, question, error) => {
  const user = userEvent.setup()
  mockDocForm = docForm
  render(<NewSegmentModal {...props} docForm={docForm} />)
  if (question) await user.type(screen.getByRole('textbox', { name: 'QUESTION' }), question)
  await user.click(save())
  expect(toastErrorSpy).toHaveBeenCalledWith(`datasetDocuments.segment.${error}`)
  expect(mockAddSegment).not.toHaveBeenCalled()
})

it.each([true, false])(
  'saves new content, refreshes the document and respects add-another=%s',
  async (addAnother) => {
    const user = userEvent.setup()
    render(<NewSegmentModal {...props} />)
    if (!addAnother)
      await user.click(
        screen.getByRole('checkbox', { name: 'datasetDocuments.segment.addAnother' }),
      )
    await user.type(content(), 'New content')
    await user.click(save())
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce())
    expect(mockAddSegment).toHaveBeenCalledExactlyOnceWith({
      params: { dataset_id: 'test-dataset-id', document_id: 'test-document-id' },
      body: { content: 'New content', attachment_ids: [] },
    })
    expect(content()).toHaveValue('')
    expect(props.onCancel).toHaveBeenCalledTimes(addAnother ? 0 : 1)
  },
)

it('includes QA answers and selected economy keywords in the creation request', async () => {
  const user = userEvent.setup()
  mockIndexingTechnique = IndexingType.ECONOMICAL
  mockDocForm = ChunkingMode.qa
  render(<NewSegmentModal {...props} docForm={ChunkingMode.qa} />)
  await user.type(screen.getByRole('textbox', { name: 'QUESTION' }), 'Question')
  await user.type(screen.getByRole('textbox', { name: 'ANSWER' }), 'Answer')
  await user.type(
    screen.getByPlaceholderText('datasetDocuments.segment.addKeyWord'),
    'keyword{Enter}',
  )
  await user.click(save())
  await waitFor(() =>
    expect(mockAddSegment).toHaveBeenCalledWith({
      params: { dataset_id: 'test-dataset-id', document_id: 'test-document-id' },
      body: { content: 'Question', answer: 'Answer', keywords: ['keyword'], attachment_ids: [] },
    }),
  )
})

it('includes only uploaded attachment IDs in the creation request', async () => {
  const user = userEvent.setup()
  render(<NewSegmentModal {...props} />)
  await user.type(content(), 'Content with images')
  const file = {
    id: 'local-1',
    name: 'photo.jpg',
    size: 20,
    mimeType: 'image/jpeg',
    extension: 'jpg',
    progress: 100,
  }
  act(() =>
    uploaderProps.onChange([
      { ...file, uploadedId: 'uploaded-1' },
      { ...file, id: 'local-2', progress: 50 },
    ]),
  )
  await user.click(save())
  await waitFor(() =>
    expect(mockAddSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { content: 'Content with images', attachment_ids: ['uploaded-1'] },
      }),
    ),
  )
})

it('opens the newly created chunk through the success notification action', async () => {
  const user = userEvent.setup()
  mockFullScreen = true
  render(
    <>
      <AppToaster timeout={0} />
      <NewSegmentModal {...props} />
    </>,
  )
  await user.type(content(), 'New content')
  await user.click(save())
  await user.click(await screen.findByRole('button', { name: 'common.operation.view' }))
  expect(props.viewNewlyAddedChunk).toHaveBeenCalledOnce()
  expect(toastSuccessSpy).toHaveBeenCalledOnce()
})

it('cancels an unsaved draft', async () => {
  const user = userEvent.setup()
  render(<NewSegmentModal {...props} />)
  await user.type(content(), 'Draft')
  await user.click(screen.getByRole('button', { name: /common.operation.cancel/ }))
  expect(props.onCancel).toHaveBeenCalledOnce()
  expect(mockAddSegment).not.toHaveBeenCalled()
})
