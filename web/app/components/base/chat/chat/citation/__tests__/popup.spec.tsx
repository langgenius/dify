import type { Resources } from '../index'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { downloadUrl } from '@/utils/download'
import Popup from '../popup'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

const mockDownloadDocument = vi.fn()
const mockDownloadUrl = vi.mocked(downloadUrl)

const makeSource = (
  overrides: Partial<Resources['sources'][number]> = {},
): Resources['sources'][number] =>
  ({
    dataset_id: 'ds-1',
    dataset_name: 'Test Dataset',
    document_id: 'doc-1',
    segment_id: 'seg-1',
    segment_position: 1,
    content: 'Source content here',
    word_count: 120,
    hit_count: 3,
    index_node_hash: 'abcdef1234567',
    score: 0.85,
    data_source_type: 'upload_file',
    document_name: 'test.pdf',
    ...overrides,
  }) as Resources['sources'][number]

const makeData = (overrides: Partial<Resources> = {}): Resources => ({
  documentId: 'doc-1',
  documentName: 'report.pdf',
  dataSourceType: 'upload_file',
  sources: [makeSource()],
  ...overrides,
})

const openPopup = async (user: ReturnType<typeof userEvent.setup>, name = 'report.pdf') => {
  await user.click(screen.getByRole('button', { name }))
  return screen.getByRole('dialog')
}

beforeEach(() => {
  mockDownloadDocument.mockResolvedValue({ url: 'https://example.com/file.pdf' })
})

it.each(['upload_file', 'file'])(
  'downloads the original %s document using its primary id and name',
  async (dataSourceType) => {
    const user = userEvent.setup()
    render(<Popup data={makeData({ dataSourceType, documentId: 'primary-id' })} />)
    const popup = await openPopup(user)
    await user.click(within(popup).getByRole('button', { name: 'report.pdf' }))
    await waitFor(() =>
      expect(mockDownloadUrl).toHaveBeenCalledExactlyOnceWith({
        url: 'https://example.com/file.pdf',
        fileName: 'report.pdf',
      }),
    )
    expect(mockDownloadDocument).toHaveBeenCalledExactlyOnceWith({
      params: { dataset_id: 'ds-1', document_id: 'primary-id' },
    })
  },
)

it.each([
  { dataSourceType: 'notion', datasetId: 'ds-1', documentId: 'doc-1' },
  { dataSourceType: 'upload_file', datasetId: '', documentId: 'doc-1' },
  { dataSourceType: 'upload_file', datasetId: 'ds-1', documentId: '' },
])(
  'shows source content without a download action for $dataSourceType / $datasetId / $documentId',
  async ({ dataSourceType, datasetId, documentId }) => {
    const user = userEvent.setup()
    render(
      <Popup
        data={makeData({
          dataSourceType,
          documentId,
          sources: [makeSource({ dataset_id: datasetId, document_id: documentId })],
        })}
      />,
    )
    const popup = await openPopup(user)
    expect(within(popup).getByText('Source content here')).toBeInTheDocument()
    expect(within(popup).queryByRole('button', { name: 'report.pdf' })).not.toBeInTheDocument()
    expect(mockDownloadDocument).not.toHaveBeenCalled()
  },
)

it('blocks duplicate downloads while pending and allows retry after a failed request', async () => {
  const response = createDeferred<{ url: string }>()
  mockDownloadDocument.mockReturnValueOnce(response.promise)
  const user = userEvent.setup()
  render(<Popup data={makeData({ documentId: '' })} />)
  const popup = await openPopup(user)
  const download = within(popup).getByRole('button', { name: 'report.pdf' })
  await user.click(download)
  await waitFor(() => expect(download).toBeDisabled())
  await user.click(download)
  expect(mockDownloadDocument).toHaveBeenCalledTimes(1)
  await act(async () => response.reject(new Error('Download unavailable')))
  await waitFor(() => expect(download).toBeEnabled())
  expect(mockDownloadUrl).not.toHaveBeenCalled()
  await user.click(download)
  await waitFor(() =>
    expect(mockDownloadUrl).toHaveBeenCalledExactlyOnceWith({
      url: 'https://example.com/file.pdf',
      fileName: 'report.pdf',
    }),
  )
  expect(mockDownloadDocument).toHaveBeenLastCalledWith({
    params: { dataset_id: 'ds-1', document_id: 'doc-1' },
  })
})

it('does not start a download when the service returns no URL', async () => {
  mockDownloadDocument.mockResolvedValue({ url: '' })
  const user = userEvent.setup()
  render(<Popup data={makeData()} />)
  const popup = await openPopup(user)
  const download = within(popup).getByRole('button', { name: 'report.pdf' })
  await user.click(download)
  await waitFor(() => expect(mockDownloadDocument).toHaveBeenCalled())
  await waitFor(() => expect(download).toBeEnabled())
  expect(mockDownloadUrl).not.toHaveBeenCalled()
})

it('shows each citation alongside its segment position and document provenance', async () => {
  const user = userEvent.setup()
  render(
    <Popup
      showHitInfo
      data={makeData({
        sources: [
          makeSource({ segment_position: 7, content: 'First source', score: 0.856 }),
          makeSource({
            segment_id: 'seg-2',
            document_id: 'doc-2',
            segment_position: 0,
            content: 'Second source',
            score: 0,
          }),
        ],
      })}
    />,
  )
  await openPopup(user)
  const sources = screen.getAllByTestId('popup-source-item')
  expect(sources).toHaveLength(2)
  expect(within(sources[0]!).getByText('First source')).toBeInTheDocument()
  expect(within(sources[0]!).getByTestId('popup-segment-position')).toHaveTextContent('7')
  expect(within(sources[0]!).getByRole('link', { name: /linkToDataset/ })).toHaveAttribute(
    'href',
    '/datasets/ds-1/documents/doc-1',
  )
  expect(within(sources[1]!).getByText('Second source')).toBeInTheDocument()
  expect(within(sources[1]!).getByTestId('popup-segment-position')).toHaveTextContent('2')
  expect(within(sources[1]!).getByRole('link', { name: /linkToDataset/ })).toHaveAttribute(
    'href',
    '/datasets/ds-1/documents/doc-2',
  )
  expect(within(sources[0]!).getByRole('button', { name: '0.86' })).toBeInTheDocument()
  expect(within(sources[0]!).getByRole('button', { name: '120' })).toBeInTheDocument()
  expect(within(sources[0]!).getByRole('button', { name: '3' })).toBeInTheDocument()
  expect(within(sources[0]!).getByRole('button', { name: 'abcdef1' })).toBeInTheDocument()
  expect(within(sources[1]!).queryByTestId('progress-trigger-content')).not.toBeInTheDocument()
})

it('keeps retrieval diagnostics out of citations shown to end users', async () => {
  const user = userEvent.setup()
  render(<Popup data={makeData()} />)
  const popup = await openPopup(user)
  expect(within(popup).getByText('Source content here')).toBeInTheDocument()
  expect(within(popup).queryByRole('link', { name: /linkToDataset/ })).not.toBeInTheDocument()
  expect(within(popup).queryByRole('button', { name: 'abcdef1' })).not.toBeInTheDocument()
  expect(within(popup).queryByRole('button', { name: '0.85' })).not.toBeInTheDocument()
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.download.get': (input) =>
        mockDownloadDocument(input),
    }),
  }
})
