import type { FileEntity } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import FileItem from './file-item'

vi.mock('@remixicon/react', () => ({
  RiCloseLine: ({ className }: { className?: string }) => (
    <svg data-testid="close-icon" className={className} />
  ),
  RiDownloadLine: ({ className }: { className?: string }) => (
    <svg data-testid="download-icon" className={className} />
  ),
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick, className, size }: {
    children: React.ReactNode
    onClick?: (e: React.MouseEvent) => void
    className?: string
    size?: string
  }) => (
    <button data-testid="action-button" onClick={onClick} className={className} data-size={size}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, className }: {
    children: React.ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <button data-testid="button" onClick={onClick} className={className}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/file-uploader/audio-preview', () => ({
  default: ({ title, url, onCancel }: { title: string, url: string, onCancel: () => void }) => (
    <div data-testid="audio-preview" data-title={title} data-url={url}>
      <button data-testid="close-audio-preview" onClick={onCancel}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/file-uploader/dynamic-pdf-preview', () => ({
  default: ({ url, onCancel }: { url: string, onCancel: () => void }) => (
    <div data-testid="pdf-preview" data-url={url}>
      <button data-testid="close-pdf-preview" onClick={onCancel}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/file-uploader/video-preview', () => ({
  default: ({ title, url, onCancel }: { title: string, url: string, onCancel: () => void }) => (
    <div data-testid="video-preview" data-title={title} data-url={url}>
      <button data-testid="close-video-preview" onClick={onCancel}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  ReplayLine: ({ className, onClick }: { className?: string, onClick?: () => void }) => (
    <svg data-testid="replay-icon" className={className} onClick={onClick} />
  ),
}))

vi.mock('@/app/components/base/progress-bar/progress-circle', () => ({
  default: ({ percentage }: { percentage: number }) => (
    <div data-testid="progress-circle" data-percentage={percentage} />
  ),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('@/utils/format', () => ({
  formatFileSize: (size: number) => `${size}B`,
}))

vi.mock('../file-type-icon', () => ({
  default: ({ type }: { type: string }) => (
    <span data-testid="file-type-icon" data-type={type} />
  ),
}))

vi.mock('../utils', () => ({
  fileIsUploaded: (file: FileEntity) => file.progress === 100 && !!file.uploadedId,
  getFileAppearanceType: () => 'document',
  getFileExtension: (name: string) => {
    const parts = name.split('.')
    return parts.length > 1 ? parts.pop()!.toUpperCase() : ''
  },
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

    expect(screen.getByText('document.pdf')).toBeInTheDocument()
  })

  it('should render file extension and size', () => {
    render(<FileItem file={createFile()} />)

    // Extension and size are rendered as direct text nodes in the same parent
    const metaDiv = screen.getByTestId('file-type-icon').closest('div')!
    expect(metaDiv.textContent).toContain('PDF')
    expect(metaDiv.textContent).toContain('2048B')
  })

  it('should render FileTypeIcon', () => {
    render(<FileItem file={createFile()} />)

    expect(screen.getByTestId('file-type-icon')).toBeInTheDocument()
  })

  it('should render delete button when showDeleteAction is true', () => {
    render(<FileItem file={createFile()} showDeleteAction />)

    expect(screen.getByTestId('close-icon')).toBeInTheDocument()
  })

  it('should call onRemove when delete button is clicked', () => {
    const onRemove = vi.fn()
    render(<FileItem file={createFile()} showDeleteAction onRemove={onRemove} />)

    const deleteBtn = screen.getByTestId('close-icon').closest('button')
    fireEvent.click(deleteBtn!)

    expect(onRemove).toHaveBeenCalledWith('file-1')
  })

  it('should render progress circle when file is uploading', () => {
    render(<FileItem file={createFile({ progress: 50, uploadedId: undefined })} />)

    expect(screen.getByTestId('progress-circle')).toBeInTheDocument()
  })

  it('should render replay icon when upload failed', () => {
    render(<FileItem file={createFile({ progress: -1 })} />)

    expect(screen.getByTestId('replay-icon')).toBeInTheDocument()
  })

  it('should call onReUpload when replay icon is clicked', () => {
    const onReUpload = vi.fn()
    render(<FileItem file={createFile({ progress: -1 })} onReUpload={onReUpload} />)

    fireEvent.click(screen.getByTestId('replay-icon'))

    expect(onReUpload).toHaveBeenCalledWith('file-1')
  })

  it('should have error styling when upload failed', () => {
    const { container } = render(<FileItem file={createFile({ progress: -1 })} />)

    expect(container.querySelector('.border-state-destructive-border')).toBeInTheDocument()
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

    const fileName = screen.getByText('audio.mp3')
    fireEvent.click(fileName)

    expect(screen.getByTestId('audio-preview')).toBeInTheDocument()
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

    const fileName = screen.getByText('video.mp4')
    fireEvent.click(fileName)

    expect(screen.getByTestId('video-preview')).toBeInTheDocument()
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

    const fileName = screen.getByText('doc.pdf')
    fireEvent.click(fileName)

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

    fireEvent.click(screen.getByText('audio.mp3'))
    fireEvent.click(screen.getByTestId('close-audio-preview'))

    expect(screen.queryByTestId('audio-preview')).not.toBeInTheDocument()
  })

  it('should render download button when showDownloadAction is true and url exists', () => {
    render(<FileItem file={createFile()} showDownloadAction />)

    expect(screen.getByTestId('download-icon')).toBeInTheDocument()
  })

  it('should call downloadUrl when download button is clicked', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(<FileItem file={createFile()} showDownloadAction />)

    const downloadBtn = screen.getByTestId('download-icon').closest('button')
    fireEvent.click(downloadBtn!)

    expect(downloadUrl).toHaveBeenCalled()
  })

  it('should not render download button when showDownloadAction is false', () => {
    render(<FileItem file={createFile()} showDownloadAction={false} />)

    expect(screen.queryByTestId('download-icon')).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByText('audio.mp3'))

    expect(screen.queryByTestId('audio-preview')).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByText('video.mp4'))
    fireEvent.click(screen.getByTestId('close-video-preview'))

    expect(screen.queryByTestId('video-preview')).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByText('doc.pdf'))
    fireEvent.click(screen.getByTestId('close-pdf-preview'))

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

    fireEvent.click(screen.getByText('audio.mp3'))

    expect(screen.getByTestId('audio-preview')).toBeInTheDocument()
  })
})
