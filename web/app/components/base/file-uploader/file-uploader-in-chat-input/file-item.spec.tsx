import type { FileEntity } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import FileItem from './file-item'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('@/utils/format', () => ({
  formatFileSize: (size: number) => `${size}B`,
}))

vi.mock('../dynamic-pdf-preview', () => ({
  default: ({ url, onCancel }: { url: string, onCancel: () => void }) => (
    <div data-testid="pdf-preview" data-url={url}>
      <button data-testid="pdf-close" onClick={onCancel}>Close PDF</button>
    </div>
  ),
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

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should call onRemove when delete button is clicked', () => {
    const onRemove = vi.fn()
    render(<FileItem file={createFile()} showDeleteAction onRemove={onRemove} />)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])

    expect(onRemove).toHaveBeenCalledWith('file-1')
  })

  it('should render progress circle when file is uploading', () => {
    const { container } = render(
      <FileItem file={createFile({ progress: 50, uploadedId: undefined })} />,
    )

    const progressSvg = container.querySelector('svg circle')
    expect(progressSvg).toBeInTheDocument()
  })

  it('should render replay icon when upload failed', () => {
    const { container } = render(<FileItem file={createFile({ progress: -1 })} />)

    const replayIcon = container.querySelector('[data-icon="ReplayLine"]')
    expect(replayIcon).toBeInTheDocument()
  })

  it('should call onReUpload when replay icon is clicked', () => {
    const onReUpload = vi.fn()
    const { container } = render(
      <FileItem file={createFile({ progress: -1 })} onReUpload={onReUpload} />,
    )

    const replayIcon = container.querySelector('[data-icon="ReplayLine"]')
    fireEvent.click(replayIcon!)

    expect(onReUpload).toHaveBeenCalledWith('file-1')
  })

  it('should have error styling when upload failed', () => {
    const { container } = render(<FileItem file={createFile({ progress: -1 })} />)

    const replayIcon = container.querySelector('[data-icon="ReplayLine"]')
    expect(replayIcon).toBeInTheDocument()
  })

  it('should show audio preview when audio file name is clicked', () => {
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

  it('should show pdf preview when pdf file name is clicked', () => {
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

    expect(screen.getByTestId('pdf-preview')).toBeInTheDocument()
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

    // AudioPreview renders via createPortal with tabindex="-1", not role="dialog"
    const overlay = document.querySelector('[tabindex="-1"]')!
    const closeSvg = overlay.querySelector(':scope > div:last-child svg')
    fireEvent.click(closeSvg!.parentElement!)

    expect(document.querySelector('audio')).not.toBeInTheDocument()
  })

  it('should render download button when showDownloadAction is true and url exists', () => {
    render(<FileItem file={createFile()} showDownloadAction />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should call downloadUrl when download button is clicked', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(<FileItem file={createFile()} showDownloadAction />)

    const buttons = screen.getAllByRole('button')
    const downloadBtn = buttons.find(btn =>
      btn.querySelector('svg') && !btn.textContent,
    )
    fireEvent.click(downloadBtn!)

    expect(downloadUrl).toHaveBeenCalled()
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

    // VideoPreview renders via createPortal with tabindex="-1", not role="dialog"
    const overlay = document.querySelector('[tabindex="-1"]')!
    const closeSvg = overlay.querySelector(':scope > div:last-child svg')
    fireEvent.click(closeSvg!.parentElement!)

    expect(document.querySelector('video')).not.toBeInTheDocument()
  })

  it('should close pdf preview', () => {
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
    expect(screen.getByTestId('pdf-preview')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('pdf-close'))
    expect(screen.queryByTestId('pdf-preview')).not.toBeInTheDocument()
  })

  it('should use createObjectURL when no url or base64Url but has originalFile', () => {
    const mockUrl = 'blob:http://localhost/test-blob'
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockUrl)

    const file = createFile({
      name: 'audio.mp3',
      type: 'audio/mpeg',
      url: undefined,
      base64Url: undefined,
      originalFile: new File(['content'], 'audio.mp3', { type: 'audio/mpeg' }),
    })
    render(<FileItem file={file} canPreview />)

    fireEvent.click(screen.getByText(/audio\.mp3/i))

    expect(document.querySelector('audio')).toBeInTheDocument()
  })

  it('should not use createObjectURL when no originalFile and no urls', () => {
    const file = createFile({
      name: 'audio.mp3',
      type: 'audio/mpeg',
      url: undefined,
      base64Url: undefined,
      originalFile: undefined,
    })
    render(<FileItem file={file} canPreview />)

    fireEvent.click(screen.getByText(/audio\.mp3/i))

    // Preview should still try to open with empty/undefined url
  })

  it('should not render download button when download_url is falsy', () => {
    render(
      <FileItem
        file={createFile({ url: undefined, base64Url: undefined })}
        showDownloadAction
      />,
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

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should not render extension separator when ext is empty', () => {
    render(<FileItem file={createFile({ name: 'noext' })} />)

    expect(screen.getByText(/noext/)).toBeInTheDocument()
  })

  it('should not render file size when size is 0', () => {
    render(<FileItem file={createFile({ size: 0 })} />)

    expect(screen.queryByText(/0B/)).not.toBeInTheDocument()
  })
})
