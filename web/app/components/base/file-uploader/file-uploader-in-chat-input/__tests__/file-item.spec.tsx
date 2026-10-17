import type { ReactNode } from 'react'
import type { FileEntity } from '../../types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { FileItem } from '../file-item'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('../../pdf-highlighter-adapter', () => ({
  PdfLoader: ({ url, children }: { url: string; children: (doc: unknown) => ReactNode }) => (
    <div data-testid="pdf-preview" data-url={url}>
      {children({ numPages: 1 })}
    </div>
  ),
  PdfHighlighter: () => <div>PDF page</div>,
}))

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'document.pdf',
  size: 2048,
  type: 'application/pdf',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  uploadedId: 'uploaded-1',
  url: 'https://example.com/document.pdf',
  ...overrides,
})

describe('FileItem (chat-input)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => vi.restoreAllMocks())

  it('should render file name', async () => {
    render(<FileItem file={createFile()} />)

    expect(screen.getByText(/document\.pdf/i)).toBeInTheDocument()
  })

  it('should render file extension and size', async () => {
    const { container } = render(<FileItem file={createFile()} />)

    // Extension and size are rendered as text nodes in the metadata div
    expect(container.textContent).toContain('pdf')
    expect(container.textContent).toContain('2.00 KB')
  })

  it('should call onRemove when delete button is clicked', async () => {
    const onRemove = vi.fn()
    render(<FileItem file={createFile()} canPreview showDeleteAction onRemove={onRemove} />)
    const delete_button = screen.getByRole('button', { name: 'common.operation.remove' })
    await userEvent.setup().click(delete_button)
    expect(onRemove).toHaveBeenCalledWith('file-1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should call onReUpload when replay icon is clicked', async () => {
    const onReUpload = vi.fn()
    render(<FileItem file={createFile({ progress: -1 })} canPreview onReUpload={onReUpload} />)

    const replayIcon = screen.getByRole('button', { name: 'common.operation.retry' })
    await userEvent.setup().click(replayIcon!)

    expect(onReUpload).toHaveBeenCalledWith('file-1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should close audio preview', async () => {
    render(
      <FileItem
        file={createFile({
          name: 'audio.mp3',
          type: 'audio/mpeg',
          url: 'https://example.com/audio.mp3',
        })}
        canPreview
      />,
    )

    await userEvent.setup().click(screen.getByText(/audio\.mp3/i))
    expect(document.querySelector('audio source')).toHaveAttribute(
      'src',
      'https://example.com/audio.mp3',
    )

    const deleteButton = screen.getByRole('button', { name: 'common.operation.close' })
    await userEvent.setup().click(deleteButton)

    expect(document.querySelector('audio')).not.toBeInTheDocument()
  })

  it('should call downloadUrl when download button is clicked', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(<FileItem file={createFile()} canPreview showDownloadAction />)

    const downloadBtn = screen.getByRole('button', { name: 'common.operation.download' })
    await userEvent.setup().click(downloadBtn)

    expect(downloadUrl).toHaveBeenCalledWith({
      url: 'https://example.com/document.pdf?as_attachment=true',
      fileName: 'document.pdf',
      target: '_blank',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should not render download button when showDownloadAction is false', async () => {
    render(<FileItem file={createFile()} showDownloadAction={false} />)

    expect(
      screen.queryByRole('button', { name: 'common.operation.download' }),
    ).not.toBeInTheDocument()
  })

  it('should not show preview when canPreview is false', async () => {
    render(
      <FileItem
        file={createFile({
          name: 'audio.mp3',
          type: 'audio/mpeg',
        })}
        canPreview={false}
      />,
    )

    await userEvent.setup().click(screen.getByText(/audio\.mp3/i))

    expect(document.querySelector('audio')).not.toBeInTheDocument()
  })

  it('should close video preview', async () => {
    render(
      <FileItem
        file={createFile({
          name: 'video.mp4',
          type: 'video/mp4',
          url: 'https://example.com/video.mp4',
        })}
        canPreview
      />,
    )

    await userEvent.setup().click(screen.getByText(/video\.mp4/i))
    expect(document.querySelector('video source')).toHaveAttribute(
      'src',
      'https://example.com/video.mp4',
    )

    const closeBtn = screen.getByRole('button', { name: 'common.operation.close' })
    await userEvent.setup().click(closeBtn)

    expect(document.querySelector('video')).not.toBeInTheDocument()
  })

  it('should close pdf preview', async () => {
    render(
      <FileItem
        file={createFile({
          name: 'doc.pdf',
          type: 'application/pdf',
          url: 'https://example.com/doc.pdf',
        })}
        canPreview
      />,
    )

    await userEvent.setup().click(screen.getByText(/doc\.pdf/i))
    expect(await screen.findByTestId('pdf-preview')).toHaveAttribute(
      'data-url',
      'https://example.com/doc.pdf',
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('should not render download button when download_url is falsy', async () => {
    render(
      <FileItem file={createFile({ url: undefined, base64Url: undefined })} showDownloadAction />,
    )

    expect(
      screen.queryByRole('button', { name: 'common.operation.download' }),
    ).not.toBeInTheDocument()
  })

  it('should render download button when base64Url is available as download_url', async () => {
    render(
      <FileItem
        file={createFile({ url: undefined, base64Url: 'data:application/pdf;base64,abc' })}
        showDownloadAction
      />,
    )

    expect(screen.getByRole('button', { name: 'common.operation.download' })).toBeInTheDocument()
  })

  it.each([
    { type: 'text/plain', url: 'https://example.com/file.txt', canPreview: true },
    { type: 'audio/mpeg', url: undefined, canPreview: true },
    { type: 'audio/mpeg', url: 'https://example.com/audio.mp3', canPreview: false },
  ])('keeps filename static when preview is unavailable: %j', ({ type, url, canPreview }) => {
    render(<FileItem file={createFile({ name: 'filename', type, url })} canPreview={canPreview} />)
    expect(screen.getByText('filename')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'filename' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['audio/mpeg', 'video/mp4'])(
    'preserves native controls without autoplay for %s',
    async (type) => {
      const { container } = render(
        <FileItem file={createFile({ name: 'media', type })} canPreview />,
      )
      await userEvent.setup().click(screen.getByRole('button', { name: 'media' }))
      const media = within(screen.getByRole('dialog')).getByTitle('media')
      expect(media.querySelector('source')).toHaveAttribute('type', type)
      expect(media).toHaveAttribute('controls')
      expect(media).toHaveAttribute('preload', 'metadata')
      expect(media).not.toHaveAttribute('autoplay')
      expect(container.querySelector('audio,video')).not.toBeInTheDocument()
      await userEvent.setup().click(media)
      expect(screen.getByRole('dialog', { name: 'media' })).toBeInTheDocument()
      await userEvent.setup().keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('keeps the open source while upload completes and releases its Blob before the next session', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-audio')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    const file = createFile({
      name: 'audio.mp3',
      type: 'audio/mpeg',
      url: undefined,
      originalFile: new File(['audio'], 'audio.mp3', { type: 'audio/mpeg' }),
    })
    const { rerender } = render(<FileItem file={file} canPreview />)
    expect(createObjectURL).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'audio.mp3' }))
    expect(document.querySelector('audio source')).toHaveAttribute('src', 'blob:local-audio')
    rerender(<FileItem file={{ ...file, url: 'https://example.com/uploaded.mp3' }} canPreview />)
    expect(document.querySelector('audio source')).toHaveAttribute('src', 'blob:local-audio')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:local-audio')
    await userEvent.setup().click(screen.getByRole('button', { name: 'audio.mp3' }))
    expect(document.querySelector('audio source')).toHaveAttribute(
      'src',
      'https://example.com/uploaded.mp3',
    )
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    await userEvent.setup().keyboard('{Escape}')
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

  it.each([
    { url: 'https://example.com/remote.mp3', expected: 'https://example.com/remote.mp3' },
    { url: undefined, expected: 'data:audio/mpeg;base64,YQ==' },
  ])(
    'borrows the preferred URL without creating or revoking it: $expected',
    async ({ url, expected }) => {
      const createObjectURL = vi.spyOn(URL, 'createObjectURL')
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
      render(
        <FileItem
          file={createFile({
            name: 'audio.mp3',
            type: 'audio/mpeg',
            url,
            base64Url: 'data:audio/mpeg;base64,YQ==',
            originalFile: new File(['audio'], 'audio.mp3'),
          })}
          canPreview
        />,
      )
      await userEvent.setup().click(screen.getByRole('button', { name: 'audio.mp3' }))
      expect(document.querySelector('audio source')).toHaveAttribute('src', expected)
      await userEvent.setup().keyboard('{Escape}')
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(revokeObjectURL).not.toHaveBeenCalled()
      createObjectURL.mockRestore()
      revokeObjectURL.mockRestore()
    },
  )

  it('ends the resource session if preview permission is removed', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-audio')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    const file = createFile({
      name: 'audio.mp3',
      type: 'audio/mpeg',
      url: undefined,
      originalFile: new File(['audio'], 'audio.mp3'),
    })
    const { rerender } = render(<FileItem file={file} canPreview />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'audio.mp3' }))
    rerender(<FileItem file={file} canPreview={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'audio.mp3' })).not.toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-audio')
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })
})
