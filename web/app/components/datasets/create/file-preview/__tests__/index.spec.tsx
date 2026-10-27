import type { TextContentResponse } from '@dify/contracts/api/console/files/types.gen'
import type { ReactElement } from 'react'
import type { CustomFile as File } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilePreview from '../index'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({ request: mocks.request }))

const createFile = (overrides: Partial<File> = {}): File =>
  Object.assign(new globalThis.File(['Preview'], 'document.txt', { type: 'text/plain' }), {
    id: 'file-123',
    extension: 'txt',
    ...overrides,
  })
const response = (content: string) => Response.json({ content } satisfies TextContentResponse)
const renderPreview = (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

// Exercise generated query options and transport; mock only the HTTP boundary.
describe('FilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockResolvedValue(response('Preview content'))
  })

  it('loads the selected file through the generated endpoint and announces success', async () => {
    let resolveRequest!: (value: Response) => void
    mocks.request.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )
    renderPreview(<FilePreview file={createFile()} hidePreview={vi.fn()} />)

    expect(
      screen.getByRole('region', { name: 'datasetCreation.stepOne.filePreview' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'datasetCreation.stepOne.filePreview' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('document.txt: common.loading')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce())
    expect(mocks.request.mock.calls[0]?.[0]).toContain('/files/file-123/preview')

    await act(async () => resolveRequest(response('Preview content')))
    expect(await screen.findByText('Preview content')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('document.txt: common.api.success')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it.each([undefined, createFile({ id: undefined }), createFile({ id: '' })])(
    'does not request or announce a preview without an uploaded file ID (%#)',
    (file) => {
      renderPreview(<FilePreview file={file} hidePreview={vi.fn()} />)
      expect(mocks.request).not.toHaveBeenCalled()
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    },
  )

  it('starts the preview when an upload receives its file ID', async () => {
    const { rerender } = renderPreview(
      <FilePreview file={createFile({ id: undefined })} hidePreview={vi.fn()} />,
    )
    expect(mocks.request).not.toHaveBeenCalled()
    rerender(<FilePreview file={createFile()} hidePreview={vi.fn()} />)
    expect(await screen.findByText('Preview content')).toBeInTheDocument()
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('announces failure and stops loading when the request fails', async () => {
    mocks.request.mockResolvedValue(new Response(null, { status: 500 }))
    renderPreview(<FilePreview file={createFile()} hidePreview={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('document.txt: common.api.actionFailed'),
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('keeps the current preview when an earlier file request finishes last', async () => {
    let resolveFirst!: (value: Response) => void
    mocks.request
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce(response('Latest preview'))
    const { rerender } = renderPreview(
      <FilePreview file={createFile({ id: 'first' })} hidePreview={vi.fn()} />,
    )
    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce())
    rerender(<FilePreview file={createFile({ id: 'second' })} hidePreview={vi.fn()} />)
    expect(await screen.findByText('Latest preview')).toBeInTheDocument()
    expect(mocks.request.mock.calls[1]?.[0]).toContain('/files/second/preview')
    await act(async () => resolveFirst(response('Stale preview')))
    expect(screen.getByText('Latest preview')).toBeInTheDocument()
    expect(screen.queryByText('Stale preview')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('common.api.success')
  })

  it('announces success for an empty preview', async () => {
    mocks.request.mockResolvedValue(response(''))
    renderPreview(<FilePreview file={createFile()} hidePreview={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('common.api.success'))
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('closes the preview through its named button', async () => {
    const user = userEvent.setup()
    const hidePreview = vi.fn()
    renderPreview(<FilePreview file={createFile()} hidePreview={hidePreview} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(hidePreview).toHaveBeenCalledOnce()
  })
})
