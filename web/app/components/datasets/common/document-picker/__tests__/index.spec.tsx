import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { createDeferred } from '@/test/deferred'
import { DocumentPicker } from '../index'

let mockDocumentListData: { data: DocumentWithSegmentsResponse[] } | undefined

const { mockUseDocumentList } = vi.hoisted(() => ({
  mockUseDocumentList: vi.fn(),
}))

const createDocument = (
  overrides: Partial<DocumentWithSegmentsResponse> = {},
): DocumentWithSegmentsResponse => ({
  id: 'doc-1',
  position: 1,
  data_source_type: DataSourceType.FILE,
  data_source_info: {
    upload_file: {
      id: 'file-1',
      name: 'document.pdf',
      size: 1024,
      extension: 'pdf',
      mime_type: 'application/pdf',
      created_by: 'user-1',
      created_at: 1700000000,
    },
    job_id: 'job-1',
    url: '',
  },
  dataset_process_rule_id: 'rule-1',
  name: 'Document 1',
  created_from: 'web',
  created_by: 'user-1',
  created_at: 1700000000,
  indexing_status: 'completed',
  display_status: 'enabled',
  doc_form: ChunkingMode.text,
  enabled: true,
  word_count: 1000,
  archived: false,
  hit_count: 0,
  data_source_detail_dict: {
    upload_file: {
      id: 'file-1',
      name: 'document.pdf',
      size: 1024,
      extension: 'pdf',
      mime_type: 'application/pdf',
      created_by: 'user-1',
      created_at: 1700000000,
    },
  },
  ...overrides,
})

const createProps = (overrides: Partial<React.ComponentProps<typeof DocumentPicker>> = {}) => ({
  datasetId: 'dataset-1',
  currentDocument: createDocument({ id: 'doc-1', name: 'Document 1' }),
  ...overrides,
})

const renderDocumentPicker = (props: Partial<React.ComponentProps<typeof DocumentPicker>> = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  const defaultProps = createProps(props)

  return {
    props: defaultProps,
    ...render(
      <QueryClientProvider client={queryClient}>
        <DocumentPicker {...defaultProps} />
      </QueryClientProvider>,
    ),
  }
}

describe('DocumentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocumentListData = {
      data: [
        createDocument({ id: 'doc-1', name: 'Document 1' }),
        createDocument({ id: 'doc-2', name: 'Document 2' }),
      ],
    }
    mockUseDocumentList.mockImplementation(() =>
      Promise.resolve({
        ...mockDocumentListData,
        total: mockDocumentListData?.data.length ?? 0,
        page: 1,
        limit: 20,
        has_more: false,
      }),
    )
  })

  it('should render the current document and chunking mode', () => {
    renderDocumentPicker({
      currentDocument: createDocument({
        id: 'current-doc',
        name: 'Current Document',
        doc_form: ChunkingMode.parentChild,
      }),
      parentMode: 'paragraph',
    })

    expect(screen.getByRole('button', { name: 'Current Document' })).toBeInTheDocument()
    expect(screen.getByText(/dataset.chunkingMode.parentChild/)).toBeInTheDocument()
    expect(screen.getByText(/dataset.parentMode.paragraph/)).toBeInTheDocument()
  })

  it('should fetch documents with the current dataset and search keyword', async () => {
    const user = userEvent.setup()
    renderDocumentPicker({ datasetId: 'dataset-custom' })

    await user.click(screen.getByRole('button', { name: 'Document 1' }))
    await user.type(screen.getByPlaceholderText('common.operation.search'), 'report')

    await waitFor(() => {
      expect(mockUseDocumentList).toHaveBeenLastCalledWith({
        params: { dataset_id: 'dataset-custom' },
        query: {
          keyword: 'report',
          page: 1,
          limit: 20,
        },
      })
    })
  })

  it('should keep focus in the search input when deleting from an empty result', async () => {
    const user = userEvent.setup()
    mockUseDocumentList.mockImplementation(({ query }) =>
      Promise.resolve({
        ...mockDocumentListData,
        data: query.keyword === 'missing' ? [] : mockDocumentListData?.data,
        total: query.keyword === 'missing' ? 0 : mockDocumentListData?.data.length,
        page: 1,
        limit: 20,
        has_more: false,
      }),
    )

    renderDocumentPicker()

    const trigger = screen.getByRole('button', { name: 'Document 1' })
    await user.click(trigger)

    const searchInput = screen.getByPlaceholderText('common.operation.search')
    await user.type(searchInput, 'missing')
    expect(await screen.findByText('common.noData')).toBeInTheDocument()

    await user.keyboard(
      '{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}',
    )

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(searchInput).toHaveFocus()
    expect(trigger).not.toHaveFocus()
  })

  it('renders document links and marks only the current page', async () => {
    const user = userEvent.setup()
    renderDocumentPicker()

    await user.click(screen.getByRole('button', { name: 'Document 1' }))
    const currentDocument = await screen.findByRole('menuitem', { name: 'Document 1' })
    const otherDocument = screen.getByRole('menuitem', { name: 'Document 2' })

    expect(currentDocument).toHaveAttribute('href', '/datasets/dataset-1/documents/doc-1')
    expect(currentDocument).toHaveAttribute('aria-current', 'page')
    expect(otherDocument).toHaveAttribute('href', '/datasets/dataset-1/documents/doc-2')
    expect(otherDocument).not.toHaveAttribute('aria-current')
  })

  it('removes previous-query links until the new server results arrive', async () => {
    const user = userEvent.setup()
    const response = {
      data: [createDocument({ id: 'report-id', name: 'Quarterly report' })],
      total: 1,
      page: 1,
      limit: 20,
      has_more: false,
    }
    const pendingSearch = createDeferred<typeof response>()
    const initialResponse = mockUseDocumentList.getMockImplementation()!
    mockUseDocumentList.mockImplementation((input) =>
      input.query.keyword === 'report' ? pendingSearch.promise : initialResponse(input),
    )
    renderDocumentPicker()

    await user.click(screen.getByRole('button', { name: 'Document 1' }))
    await screen.findByRole('menuitem', { name: 'Document 2' })
    const input = screen.getByRole('searchbox', { name: 'common.operation.search' })
    await user.type(input, 'report')

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('common.loading')
    expect(screen.queryByText('common.noData')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockUseDocumentList).toHaveBeenLastCalledWith({
        params: { dataset_id: 'dataset-1' },
        query: { keyword: 'report', page: 1, limit: 20 },
      })
    })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()

    pendingSearch.resolve(response)
    const result = await screen.findByRole('menuitem', { name: 'Quarterly report' })
    expect(result).toHaveAttribute('href', '/datasets/dataset-1/documents/report-id')
    expect(input).toHaveFocus()
  })

  it('announces a failed search and retries without closing the menu', async () => {
    const user = userEvent.setup()
    mockUseDocumentList.mockRejectedValueOnce(new Error('Search unavailable'))
    renderDocumentPicker()

    const trigger = screen.getByRole('button', { name: 'Document 1' })
    await user.click(trigger)
    const retry = await screen.findByRole('menuitem', { name: 'common.operation.retry' })
    expect(screen.getByRole('status')).toHaveTextContent('common.dynamicSelect.error')
    expect(screen.queryByText('common.noData')).not.toBeInTheDocument()

    await user.click(retry)
    expect(await screen.findByRole('menuitem', { name: 'Document 2' })).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('resets the search when the menu closes and reopens', async () => {
    const user = userEvent.setup()
    renderDocumentPicker()

    const trigger = screen.getByRole('button', { name: 'Document 1' })
    await user.click(trigger)
    const input = screen.getByRole('searchbox', { name: 'common.operation.search' })
    await user.type(input, 'report')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(trigger)

    expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveValue('')
    expect(await screen.findByRole('menuitem', { name: 'Document 2' })).toBeInTheDocument()
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.get': mockUseDocumentList,
    }),
  }
})
