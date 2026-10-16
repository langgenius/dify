import type { ReactNode } from 'react'
import type { FileEntity } from '../../types'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import { FileItem } from '../file-item'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('@/utils/format', () => ({
  formatFileSize: (size: number) => `${size}B`,
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

  it('should render file name', () => {
    render(<FileItem file={createFile()} />)

    expect(screen.getByText(/document\.pdf/i)).toBeInTheDocument()
  })

  it('should render file extension and size', () => {
    const { container } = render(<FileItem file={createFile()} />)

    // Extension and size are rendered as text nodes in the metadata div
    expect(container.textContent).toContain('pdf')
    expect(container.textContent).toContain('2048B')
  })

  it('should render FileTypeIcon', () => {
    const { container } = render(<FileItem file={createFile()} />)

    const fileTypeIcon = container.querySelector('svg')
    expect(fileTypeIcon).toBeInTheDocument()
  })

  it('should render delete button when showDeleteAction is true', () => {
    render(<FileItem file={createFile()} showDeleteAction />)

    expect(screen.getByRole('button', { name: 'common.operation.remove' })).toBeInTheDocument()
  })

  it('should call onRemove when delete button is clicked', () => {
    const onRemove = vi.fn()
    render(<FileItem file={createFile()} canPreview showDeleteAction onRemove={onRemove} />)
    const delete_button = screen.getByRole('button', { name: 'common.operation.remove' })
    fireEvent.click(delete_button)
    expect(onRemove).toHaveBeenCalledWith('file-1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should render progress circle when file is uploading', () => {
    const { container } = render(
      <FileItem file={createFile({ progress: 50, uploadedId: undefined })} />,
    )

    const progressSvg = container.querySelector('svg circle')
    expect(progressSvg).toBeInTheDocument()
  })

  it('should render replay icon when upload failed', () => {
    render(<FileItem file={createFile({ progress: -1 })} />)

    expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeInTheDocument()
  })

  it('should call onReUpload when replay icon is clicked', () => {
    const onReUpload = vi.fn()
    render(<FileItem file={createFile({ progress: -1 })} canPreview onReUpload={onReUpload} />)

    const replayIcon = screen.getByRole('button', { name: 'common.operation.retry' })
    fireEvent.click(replayIcon!)

    expect(onReUpload).toHaveBeenCalledWith('file-1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should show audio preview when audio file name is clicked', async () => {
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

    fireEvent.click(screen.getByText(/audio\.mp3/i))

    const audioElement = document.querySelector('audio')
    expect(audioElement).toBeInTheDocument()
  })

  it('should show video preview when video file name is clicked', () => {
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

    fireEvent.click(screen.getByText(/video\.mp4/i))

    const videoElement = document.querySelector('video')
    expect(videoElement).toBeInTheDocument()
  })

  it('should show pdf preview when pdf file name is clicked', async () => {
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

    fireEvent.click(screen.getByText(/doc\.pdf/i))

    expect(await screen.findByTestId('pdf-preview')).toBeInTheDocument()
  })

  it('should close audio preview', () => {
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

    fireEvent.click(screen.getByText(/audio\.mp3/i))
    expect(document.querySelector('audio')).toBeInTheDocument()

    const deleteButton = screen.getByRole('button', { name: 'common.operation.close' })
    fireEvent.click(deleteButton)

    expect(document.querySelector('audio')).not.toBeInTheDocument()
  })

  it('should render download button when showDownloadAction is true and url exists', () => {
    render(<FileItem file={createFile()} showDownloadAction />)

    expect(screen.getByRole('button', { name: 'common.operation.download' })).toBeInTheDocument()
  })

  it('should call downloadUrl when download button is clicked', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(<FileItem file={createFile()} canPreview showDownloadAction />)

    const downloadBtn = screen.getByRole('button', { name: 'common.operation.download' })
    fireEvent.click(downloadBtn)

    expect(downloadUrl).toHaveBeenCalledWith({
      url: 'https://example.com/document.pdf&as_attachment=true',
      fileName: 'document.pdf',
      target: '_blank',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should not render download button when showDownloadAction is false', () => {
    render(<FileItem file={createFile()} showDownloadAction={false} />)

    const buttons = screen.queryAllByRole('button')
    expect(buttons).toHaveLength(0)
  })

  it('should not show preview when canPreview is false', () => {
    render(
      <FileItem
        file={createFile({
          name: 'audio.mp3',
          type: 'audio/mpeg',
        })}
        canPreview={false}
      />,
    )

    fireEvent.click(screen.getByText(/audio\.mp3/i))

    expect(document.querySelector('audio')).not.toBeInTheDocument()
  })

  it('should not throw when file type is missing', () => {
    expect(() => {
      render(
        <FileItem
          file={createFile({
            name: 'generated.png',
            type: undefined as unknown as string,
            supportFileType: 'document',
          })}
          canPreview
        />,
      )
    }).not.toThrow()
  })

  it('should close video preview', () => {
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

    fireEvent.click(screen.getByText(/video\.mp4/i))
    expect(document.querySelector('video')).toBeInTheDocument()

    const closeBtn = screen.getByRole('button', { name: 'common.operation.close' })
    fireEvent.click(closeBtn)

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

    fireEvent.click(screen.getByText(/doc\.pdf/i))
    expect(await screen.findByTestId('pdf-preview')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('should use createObjectURL when no url or base64Url but has originalFile', () => {
    const mockUrl = 'blob:http://localhost/test-blob'
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockUrl)

    const file = createFile({
      name: 'audio.mp3',
      type: 'audio/mpeg',
      url: undefined,
      base64Url: undefined,
      originalFile: new File(['content'], 'audio.mp3', { type: 'audio/mpeg' }),
    })
    render(<FileItem file={file} canPreview />)

    expect(createObjectURLSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'audio.mp3' }))

    expect(document.querySelector('audio')).toBeInTheDocument()
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    createObjectURLSpy.mockRestore()
  })

  it('should not use createObjectURL when no originalFile and no urls', () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL')
    const file = createFile({
      name: 'audio.mp3',
      type: 'audio/mpeg',
      url: undefined,
      base64Url: undefined,
      originalFile: undefined,
    })
    render(<FileItem file={file} canPreview />)

    fireEvent.click(screen.getByText(/audio\.mp3/i))
    expect(createObjectURLSpy).not.toHaveBeenCalled()
    createObjectURLSpy.mockRestore()
    expect(document.querySelector('audio')).not.toBeInTheDocument()
  })

  it('should not render download button when download_url is falsy', () => {
    render(
      <FileItem file={createFile({ url: undefined, base64Url: undefined })} showDownloadAction />,
    )

    const buttons = screen.queryAllByRole('button')
    expect(buttons).toHaveLength(0)
  })

  it('should render download button when base64Url is available as download_url', () => {
    render(
      <FileItem
        file={createFile({ url: undefined, base64Url: 'data:application/pdf;base64,abc' })}
        showDownloadAction
      />,
    )

    expect(screen.getByRole('button', { name: 'common.operation.download' })).toBeInTheDocument()
  })

  it('should not render extension separator when ext is empty', () => {
    render(<FileItem file={createFile({ name: 'noext' })} />)

    expect(screen.getByText(/noext/)).toBeInTheDocument()
  })

  it('should not render file size when size is 0', () => {
    render(<FileItem file={createFile({ size: 0 })} />)

    expect(screen.queryByText(/0B/)).not.toBeInTheDocument()
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
    (type) => {
      const { container } = render(
        <FileItem file={createFile({ name: 'media', type })} canPreview />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'media' }))
      const media = within(screen.getByRole('dialog')).getByTitle('media')
      expect(media.querySelector('source')).toHaveAttribute('type', type)
      expect(media).toHaveAttribute('controls')
      expect(media).toHaveAttribute('preload', 'metadata')
      expect(media).not.toHaveAttribute('autoplay')
      expect(container.querySelector('audio,video')).not.toBeInTheDocument()
      fireEvent.click(media)
      expect(screen.getByRole('dialog', { name: 'media' })).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
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
    fireEvent.click(screen.getByRole('button', { name: 'audio.mp3' }))
    expect(document.querySelector('audio source')).toHaveAttribute('src', 'blob:local-audio')
    rerender(<FileItem file={{ ...file, url: 'https://example.com/uploaded.mp3' }} canPreview />)
    expect(document.querySelector('audio source')).toHaveAttribute('src', 'blob:local-audio')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:local-audio')
    fireEvent.click(screen.getByRole('button', { name: 'audio.mp3' }))
    expect(document.querySelector('audio source')).toHaveAttribute(
      'src',
      'https://example.com/uploaded.mp3',
    )
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

  it.each([
    { url: 'https://example.com/remote.mp3', expected: 'https://example.com/remote.mp3' },
    { url: undefined, expected: 'data:audio/mpeg;base64,YQ==' },
  ])(
    'borrows the preferred URL without creating or revoking it: $expected',
    ({ url, expected }) => {
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
      fireEvent.click(screen.getByRole('button', { name: 'audio.mp3' }))
      expect(document.querySelector('audio source')).toHaveAttribute('src', expected)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(revokeObjectURL).not.toHaveBeenCalled()
      createObjectURL.mockRestore()
      revokeObjectURL.mockRestore()
    },
  )

  it('ends the resource session if preview permission is removed', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-audio')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    const file = createFile({
      name: 'audio.mp3',
      type: 'audio/mpeg',
      url: undefined,
      originalFile: new File(['audio'], 'audio.mp3'),
    })
    const { rerender } = render(<FileItem file={file} canPreview />)
    fireEvent.click(screen.getByRole('button', { name: 'audio.mp3' }))
    rerender(<FileItem file={file} canPreview={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'audio.mp3' })).not.toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-audio')
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })
})
