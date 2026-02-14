import type { FileEntity } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import FileInAttachmentItem from './file-item'

vi.mock('@remixicon/react', () => ({
  RiDeleteBinLine: ({ className }: { className?: string }) => (
    <svg data-testid="delete-icon" className={className} />
  ),
  RiDownloadLine: ({ className }: { className?: string }) => (
    <svg data-testid="download-icon" className={className} />
  ),
  RiEyeLine: ({ className }: { className?: string }) => (
    <svg data-testid="eye-icon" className={className} />
  ),
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick, className }: { children: React.ReactNode, onClick?: (e: React.MouseEvent) => void, className?: string }) => (
    <button data-testid="action-button" onClick={onClick} className={className}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/features/types', () => ({
  PreviewMode: {
    CurrentPage: 'current_page',
    NewPage: 'new_page',
  },
}))

vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  ReplayLine: ({ className, onClick }: { className?: string, onClick?: () => void }) => (
    <svg data-testid="replay-icon" className={className} onClick={onClick} />
  ),
}))

vi.mock('@/app/components/base/image-uploader/image-preview', () => ({
  default: ({ title, url, onCancel }: { title: string, url: string, onCancel: () => void }) => (
    <div data-testid="image-preview" data-title={title} data-url={url}>
      <button data-testid="close-preview" onClick={onCancel}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/progress-bar/progress-circle', () => ({
  default: ({ percentage }: { percentage: number }) => (
    <div data-testid="progress-circle" data-percentage={percentage} />
  ),
}))

vi.mock('@/app/components/workflow/types', () => ({
  SupportUploadFileTypes: {
    image: 'image',
  },
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('@/utils/format', () => ({
  formatFileSize: (size: number) => `${size}B`,
}))

vi.mock('../file-image-render', () => ({
  default: ({ imageUrl }: { imageUrl: string }) => (
    // eslint-disable-next-line next/no-img-element
    <img data-testid="file-image-render" src={imageUrl} alt="file" />
  ),
}))

vi.mock('../file-type-icon', () => ({
  default: ({ type }: { type: string }) => (
    <span data-testid="file-type-icon" data-type={type} />
  ),
}))

vi.mock('../utils', () => ({
  fileIsUploaded: (file: FileEntity) => file.progress === 100 && !!file.uploadedId,
  getFileAppearanceType: (name: string) => {
    if (name.endsWith('.pdf'))
      return 'pdf'
    return 'document'
  },
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

describe('FileInAttachmentItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render file name and extension', () => {
    render(<FileInAttachmentItem file={createFile()} />)

    expect(screen.getByText('document.pdf')).toBeInTheDocument()
    expect(screen.getByText('pdf')).toBeInTheDocument()
  })

  it('should render file size', () => {
    render(<FileInAttachmentItem file={createFile({ size: 2048 })} />)

    expect(screen.getByText('2048B')).toBeInTheDocument()
  })

  it('should render FileTypeIcon for non-image files', () => {
    render(<FileInAttachmentItem file={createFile()} />)

    expect(screen.getByTestId('file-type-icon')).toBeInTheDocument()
  })

  it('should render FileImageRender for image files', () => {
    render(
      <FileInAttachmentItem file={createFile({
        supportFileType: 'image',
        base64Url: 'data:image/png;base64,abc',
      })}
      />,
    )

    expect(screen.getByTestId('file-image-render')).toBeInTheDocument()
  })

  it('should render delete button when showDeleteAction is true', () => {
    render(<FileInAttachmentItem file={createFile()} showDeleteAction />)

    expect(screen.getByTestId('delete-icon')).toBeInTheDocument()
  })

  it('should not render delete button when showDeleteAction is false', () => {
    render(<FileInAttachmentItem file={createFile()} showDeleteAction={false} />)

    expect(screen.queryByTestId('delete-icon')).not.toBeInTheDocument()
  })

  it('should call onRemove when delete button is clicked', () => {
    const onRemove = vi.fn()
    render(<FileInAttachmentItem file={createFile()} showDeleteAction onRemove={onRemove} />)

    const deleteBtn = screen.getByTestId('delete-icon').closest('button')
    fireEvent.click(deleteBtn!)

    expect(onRemove).toHaveBeenCalledWith('file-1')
  })

  it('should render download button when showDownloadAction is true', () => {
    render(<FileInAttachmentItem file={createFile()} showDownloadAction />)

    expect(screen.getByTestId('download-icon')).toBeInTheDocument()
  })

  it('should render progress circle when file is uploading', () => {
    render(<FileInAttachmentItem file={createFile({ progress: 50, uploadedId: undefined })} />)

    expect(screen.getByTestId('progress-circle')).toBeInTheDocument()
    expect(screen.getByTestId('progress-circle')).toHaveAttribute('data-percentage', '50')
  })

  it('should render replay icon when upload failed', () => {
    render(<FileInAttachmentItem file={createFile({ progress: -1 })} />)

    expect(screen.getByTestId('replay-icon')).toBeInTheDocument()
  })

  it('should call onReUpload when replay icon is clicked', () => {
    const onReUpload = vi.fn()
    render(<FileInAttachmentItem file={createFile({ progress: -1 })} onReUpload={onReUpload} />)

    fireEvent.click(screen.getByTestId('replay-icon').closest('button')!)

    expect(onReUpload).toHaveBeenCalledWith('file-1')
  })

  it('should have error styling when progress is -1', () => {
    const { container } = render(<FileInAttachmentItem file={createFile({ progress: -1 })} />)

    const fileRow = container.querySelector('.border-state-destructive-border')
    expect(fileRow).toBeInTheDocument()
  })

  it('should render eye icon for previewable image files', () => {
    render(
      <FileInAttachmentItem
        file={createFile({
          supportFileType: 'image',
          url: 'https://example.com/img.png',
        })}
        canPreview
      />,
    )

    expect(screen.getByTestId('eye-icon')).toBeInTheDocument()
  })

  it('should show image preview when eye icon is clicked', () => {
    render(
      <FileInAttachmentItem
        file={createFile({
          supportFileType: 'image',
          url: 'https://example.com/img.png',
        })}
        canPreview
      />,
    )

    const eyeBtn = screen.getByTestId('eye-icon').closest('button')
    fireEvent.click(eyeBtn!)

    expect(screen.getByTestId('image-preview')).toBeInTheDocument()
  })

  it('should close image preview when close is clicked', () => {
    render(
      <FileInAttachmentItem
        file={createFile({
          supportFileType: 'image',
          url: 'https://example.com/img.png',
        })}
        canPreview
      />,
    )

    const eyeBtn = screen.getByTestId('eye-icon').closest('button')
    fireEvent.click(eyeBtn!)
    fireEvent.click(screen.getByTestId('close-preview'))

    expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument()
  })

  it('should call downloadUrl when download button is clicked', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(<FileInAttachmentItem file={createFile()} showDownloadAction />)

    const downloadBtn = screen.getByTestId('download-icon').closest('button')
    fireEvent.click(downloadBtn!)

    expect(downloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'document.pdf',
    }))
  })

  it('should open new page when previewMode is NewPage and clicked', () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <FileInAttachmentItem
        file={createFile({ url: 'https://example.com/doc.pdf' })}
        canPreview
        previewMode={'new_page' as import('@/app/components/base/features/types').PreviewMode}
      />,
    )

    const fileRow = screen.getByText('document.pdf').closest('.flex.h-12')
    fireEvent.click(fileRow!)

    expect(windowOpen).toHaveBeenCalledWith('https://example.com/doc.pdf', '_blank')
    windowOpen.mockRestore()
  })
})
