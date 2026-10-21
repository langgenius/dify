import type { ChildChunkResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import NewChildSegmentModal from '../new-child-segment'

vi.mock('@/next/navigation', () => ({
  useParams: () => ({
    datasetId: 'test-dataset-id',
    documentId: 'test-document-id',
  }),
}))

const toastErrorSpy = vi.spyOn(toast, 'error')
const toastSuccessSpy = vi.spyOn(toast, 'success')

// Mock document context
let mockParentMode = 'paragraph'
vi.mock('../../context', () => ({
  useDocumentContext: (selector: (state: { parentMode: string }) => unknown) => {
    return selector({ parentMode: mockParentMode })
  },
}))

// Mock segment list context
let mockFullScreen = false
const mockToggleFullScreen = vi.fn()
vi.mock('../index', () => ({
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

// Mock useAddChildSegment
const mockAddChildSegment = vi.fn()
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.post': (
        input,
      ) => mockAddChildSegment(input),
    }),
  }
})

const child: ChildChunkResponse = {
  id: 'new-child-id',
  segment_id: 'chunk-1',
  position: 1,
  content: 'Valid content',
  word_count: 13,
  created_at: 1700000000,
  updated_at: 1700000000,
  type: 'customized',
}
const props = {
  chunkId: 'chunk-1',
  onCancel: vi.fn(),
  onSave: vi.fn(),
  viewNewlyAddedChildChunk: vi.fn(),
}
const save = () => screen.getByRole('button', { name: /common.operation.save/ })
beforeEach(() => {
  vi.clearAllMocks()
  toast.dismiss()
  mockFullScreen = false
  mockParentMode = 'paragraph'
  mockAddChildSegment.mockReset().mockResolvedValue({ data: child })
})
afterEach(() => toast.dismiss())

it('rejects blank child content before sending the request', async () => {
  const user = userEvent.setup()
  render(<NewChildSegmentModal {...props} />)
  await user.type(screen.getByRole('textbox'), '  ')
  await user.click(save())
  expect(toastErrorSpy).toHaveBeenCalledWith('datasetDocuments.segment.contentEmpty')
  expect(mockAddChildSegment).not.toHaveBeenCalled()
})

it.each([true, false])(
  'saves to the selected parent and respects add-another (%s)',
  async (addAnother) => {
    const user = userEvent.setup()
    render(<NewChildSegmentModal {...props} />)
    if (!addAnother)
      await user.click(
        screen.getByRole('checkbox', { name: 'datasetDocuments.segment.addAnother' }),
      )
    await user.type(screen.getByRole('textbox'), child.content)
    await user.click(save())
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(child))
    expect(mockAddChildSegment).toHaveBeenCalledWith({
      params: {
        dataset_id: 'test-dataset-id',
        document_id: 'test-document-id',
        segment_id: 'chunk-1',
      },
      body: { content: child.content },
    })
    expect(toastSuccessSpy).toHaveBeenCalledOnce()
    if (addAnother) {
      expect(screen.getByRole('textbox')).toHaveValue('')
      expect(props.onCancel).not.toHaveBeenCalled()
    } else expect(props.onCancel).toHaveBeenCalledOnce()
  },
)

it('refreshes a full document after creation and opens the new child from the toast action', async () => {
  const user = userEvent.setup()
  mockParentMode = 'full-doc'
  mockFullScreen = true
  render(
    <>
      <AppToastHost timeout={0} />
      <NewChildSegmentModal {...props} />
    </>,
  )
  await user.type(screen.getByRole('textbox'), child.content)
  await user.click(save())
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith())
  await user.click(await screen.findByRole('button', { name: 'common.operation.view' }))
  expect(props.viewNewlyAddedChildChunk).toHaveBeenCalledOnce()
})

it('cancels an edited draft without creating a child', async () => {
  const user = userEvent.setup()
  render(<NewChildSegmentModal {...props} />)
  await user.type(screen.getByRole('textbox'), 'Draft')
  await user.click(screen.getByRole('button', { name: /common.operation.cancel/ }))
  expect(props.onCancel).toHaveBeenCalledOnce()
  expect(mockAddChildSegment).not.toHaveBeenCalled()
})
