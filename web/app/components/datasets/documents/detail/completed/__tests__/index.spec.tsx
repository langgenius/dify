import type { SegmentResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { DocumentContextValue } from '../../context'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode } from '@/models/datasets'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { DocumentContext } from '../../context'
import Completed from '../index'

const { getSegments, changeStatus, deleteSegments } = vi.hoisted(() => ({
  getSegments: vi.fn(),
  changeStatus: vi.fn(),
  deleteSegments: vi.fn(),
}))
vi.mock('@/next/navigation', () => ({ usePathname: () => '/datasets/ds-1/documents/doc-1' }))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// Cards and editing drawers have independent suites; this owner integrates the
// real list queries, filters, selection, pagination and batch controls.
vi.mock('../components/segment-list-content', () => ({
  GeneralModeContent: () => <div data-testid="general-content" />,
  FullDocModeContent: () => <div data-testid="full-doc-content" />,
}))
vi.mock('../components/drawer-group', () => ({ DrawerGroup: () => null }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.segments.get': (input) => getSegments(input),
      'datasets.byDatasetId.documents.byDocumentId.segment.byAction.patch': (input) =>
        changeStatus(input),
      'datasets.byDatasetId.documents.byDocumentId.segments.delete': (input) =>
        deleteSegments(input),
      'datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.get':
        async () => ({ data: [], total: 42, total_pages: 5, page: 1, limit: 10 }),
    }),
  }
})
const createMockSegmentDetail = (overrides: Partial<SegmentResponse> = {}): SegmentResponse => ({
  id: 'seg-1',
  position: 1,
  document_id: 'doc-1',
  content: 'Test segment content',
  sign_content: 'Test signed content',
  word_count: 100,
  tokens: 50,
  keywords: ['keyword1', 'keyword2'],
  index_node_id: 'index-1',
  index_node_hash: 'hash-1',
  hit_count: 10,
  enabled: true,
  disabled_at: 0,
  disabled_by: '',
  status: 'completed',
  created_by: 'user-1',
  created_at: 1700000000,
  indexing_at: 1700000100,
  completed_at: 1700000200,
  error: null,
  stopped_at: 0,
  answer: null,
  summary: null,
  updated_by: null,
  updated_at: 1700000000,
  attachments: [],
  child_chunks: [],
  ...overrides,
})

const list = () => ({
  data: [createMockSegmentDetail({ id: 'seg-1' }), createMockSegmentDetail({ id: 'seg-2' })],
  total: 30,
  total_pages: 3,
  page: 1,
  limit: 10,
})
function setup(overrides: Partial<DocumentContextValue> = {}) {
  const queryClient = createConsoleQueryClient()
  renderWithConsoleQuery(
    <DocumentContext.Provider
      value={{
        datasetId: 'ds-1',
        documentId: 'doc-1',
        docForm: ChunkingMode.text,
        parentMode: 'paragraph',
        canEdit: true,
        ...overrides,
      }}
    >
      <Completed
        embeddingAvailable
        showNewSegmentModal={false}
        onNewSegmentModalChange={vi.fn()}
        importStatus={undefined}
      />
    </DocumentContext.Provider>,
    { queryClient },
  )
  return queryClient
}
const summary = (page: number, totalPages: number) =>
  screen.getByRole('button', {
    name: `common.pagination.editPageNumber:{"page":${page},"totalPages":${totalPages}}`,
  })
beforeEach(() => {
  getSegments.mockReset().mockResolvedValue(list())
  changeStatus.mockReset().mockResolvedValue({ result: 'success' })
  deleteSegments.mockReset().mockResolvedValue({ result: 'success' })
})
afterEach(() => vi.useRealTimers())

it('requests the selected page and resets to page one when the status filter changes', async () => {
  const user = userEvent.setup()
  setup()
  await screen.findByRole('checkbox', { name: 'common.operation.selectAll' })
  expect(summary(1, 3)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
  await waitFor(() =>
    expect(getSegments).toHaveBeenLastCalledWith({
      params: { dataset_id: 'ds-1', document_id: 'doc-1' },
      query: { page: 2, limit: 10, keyword: '', enabled: 'all' },
    }),
  )
  await user.click(
    screen.getByRole('combobox', { name: 'datasetDocuments.segment.statusFilterLabel' }),
  )
  await user.click(screen.getByRole('option', { name: 'datasetDocuments.list.status.enabled' }))
  await waitFor(() =>
    expect(getSegments).toHaveBeenLastCalledWith({
      params: { dataset_id: 'ds-1', document_id: 'doc-1' },
      query: { page: 1, limit: 10, keyword: '', enabled: 'true' },
    }),
  )
  expect(summary(1, 3)).toBeInTheDocument()
})

it.each(['enable', 'disable'])('applies batch %s to selected segment IDs', async (action) => {
  const user = userEvent.setup()
  setup()
  await user.click(await screen.findByRole('checkbox', { name: 'common.operation.selectAll' }))
  await user.click(screen.getByRole('button', { name: `dataset.batchAction.${action}` }))
  await waitFor(() =>
    expect(changeStatus).toHaveBeenCalledWith({
      params: { dataset_id: 'ds-1', document_id: 'doc-1', action },
      query: { segment_id: ['seg-1', 'seg-2'] },
    }),
  )
})

it('cancels deletion without a request, then confirms deletion and clears selection', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(await screen.findByRole('checkbox', { name: 'common.operation.selectAll' }))
  await user.click(screen.getByRole('button', { name: 'dataset.batchAction.delete' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.cancel',
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(deleteSegments).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'dataset.batchAction.delete' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'common.operation.sure' }),
  )
  await waitFor(() =>
    expect(deleteSegments).toHaveBeenCalledWith({
      params: { dataset_id: 'ds-1', document_id: 'doc-1' },
      query: { segment_id: ['seg-1', 'seg-2'] },
    }),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'dataset.batchAction.delete' }),
    ).not.toBeInTheDocument(),
  )
})

it('clears selection through batch cancel without mutating documents', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(await screen.findByRole('checkbox', { name: 'common.operation.selectAll' }))
  await user.click(screen.getByRole('button', { name: 'dataset.batchAction.cancel' }))
  expect(screen.getByRole('checkbox', { name: 'common.operation.selectAll' })).not.toBeChecked()
  expect(
    screen.queryByRole('button', { name: 'dataset.batchAction.delete' }),
  ).not.toBeInTheDocument()
  expect(deleteSegments).not.toHaveBeenCalled()
  expect(changeStatus).not.toHaveBeenCalled()
})

it('disables batch mutations without edit permission', async () => {
  const user = userEvent.setup()
  setup({ canEdit: false })
  await user.click(await screen.findByRole('checkbox', { name: 'common.operation.selectAll' }))
  for (const action of ['enable', 'disable', 'delete'])
    expect(screen.getByRole('button', { name: `dataset.batchAction.${action}` })).toBeDisabled()
})

it('uses child chunk totals and omits the normal segment toolbar in full-document mode', async () => {
  setup({ docForm: ChunkingMode.parentChild, parentMode: 'full-doc' })
  await waitFor(() => expect(summary(1, 5)).toBeInTheDocument())
  expect(screen.getByTestId('full-doc-content')).toBeInTheDocument()
  expect(screen.queryByTestId('general-content')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('checkbox', { name: 'common.operation.selectAll' }),
  ).not.toBeInTheDocument()
})

it('withholds selection controls for an empty page', async () => {
  getSegments.mockResolvedValue({ ...list(), data: [], total: 0, total_pages: 0 })
  setup()
  await waitFor(() => expect(getSegments).toHaveBeenCalled())
  await act(async () => {})
  expect(
    screen.queryByRole('checkbox', { name: 'common.operation.selectAll' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'dataset.batchAction.delete' }),
  ).not.toBeInTheDocument()
})
