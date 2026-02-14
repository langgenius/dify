import type { FileEntity } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import FileImageItem from './file-image-item'

vi.mock('@remixicon/react', () => ({
  RiCloseLine: ({ className }: { className?: string }) => (
    <svg data-testid="close-icon" className={className} />
  ),
  RiDownloadLine: ({ className }: { className?: string }) => (
    <svg data-testid="download-icon" className={className} />
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

vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  ReplayLine: ({ className, onClick }: { className?: string, onClick?: () => void }) => (
    <svg data-testid="replay-icon" className={className} onClick={onClick} />
  ),
}))

vi.mock('@/app/components/base/image-uploader/image-preview', () => ({
  default: ({ title, url, onCancel }: { title: string, url: string, onCancel: () => void }) => (
    <div data-testid="image-preview" data-title={title} data-url={url}>
      <button data-testid="close-image-preview" onClick={onCancel}>Close</button>
    </div>
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

vi.mock('../file-image-render', () => ({
  default: ({ imageUrl, className, showDownloadAction }: {
    imageUrl: string
    className?: string
    showDownloadAction?: boolean
  }) => (
    // eslint-disable-next-line next/no-img-element
    <img data-testid="file-image-render" src={imageUrl} className={className} data-download={showDownloadAction} alt="file" />
  ),
}))

vi.mock('../utils', () => ({
  fileIsUploaded: (file: FileEntity) => file.progress === 100 && !!file.uploadedId,
}))

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'photo.png',
  size: 4096,
  type: 'image/png',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'image',
  uploadedId: 'uploaded-1',
  base64Url: 'data:image/png;base64,abc',
  url: 'https://example.com/photo.png',
  ...overrides,
})

describe('FileImageItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render FileImageRender with the image URL', () => {
    render(<FileImageItem file={createFile()} />)

    const img = screen.getByTestId('file-image-render')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc')
  })

  it('should use url when base64Url is not available', () => {
    render(<FileImageItem file={createFile({ base64Url: undefined })} />)

    const img = screen.getByTestId('file-image-render')
    expect(img).toHaveAttribute('src', 'https://example.com/photo.png')
  })

  it('should render delete button when showDeleteAction is true', () => {
    render(<FileImageItem file={createFile()} showDeleteAction />)

    expect(screen.getByTestId('close-icon')).toBeInTheDocument()
  })

  it('should call onRemove when delete button is clicked', () => {
    const onRemove = vi.fn()
    render(<FileImageItem file={createFile()} showDeleteAction onRemove={onRemove} />)

    const deleteBtn = screen.getByTestId('close-icon').closest('button')
    fireEvent.click(deleteBtn!)

    expect(onRemove).toHaveBeenCalledWith('file-1')
  })

  it('should render progress circle when file is uploading', () => {
    render(<FileImageItem file={createFile({ progress: 50, uploadedId: undefined })} />)

    expect(screen.getByTestId('progress-circle')).toBeInTheDocument()
    expect(screen.getByTestId('progress-circle')).toHaveAttribute('data-percentage', '50')
  })

  it('should render replay icon when upload failed', () => {
    render(<FileImageItem file={createFile({ progress: -1 })} />)

    expect(screen.getByTestId('replay-icon')).toBeInTheDocument()
  })

  it('should call onReUpload when replay icon is clicked', () => {
    const onReUpload = vi.fn()
    render(<FileImageItem file={createFile({ progress: -1 })} onReUpload={onReUpload} />)

    fireEvent.click(screen.getByTestId('replay-icon'))

    expect(onReUpload).toHaveBeenCalledWith('file-1')
  })

  it('should show image preview when clicked and canPreview is true', () => {
    render(<FileImageItem file={createFile()} canPreview />)

    const container = screen.getByTestId('file-image-render').closest('.group\\/file-image')
    fireEvent.click(container!)

    expect(screen.getByTestId('image-preview')).toBeInTheDocument()
  })

  it('should not show image preview when canPreview is false', () => {
    render(<FileImageItem file={createFile()} canPreview={false} />)

    const container = screen.getByTestId('file-image-render').closest('.group\\/file-image')
    fireEvent.click(container!)

    expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument()
  })

  it('should close image preview when close is clicked', () => {
    render(<FileImageItem file={createFile()} canPreview />)

    const container = screen.getByTestId('file-image-render').closest('.group\\/file-image')
    fireEvent.click(container!)
    fireEvent.click(screen.getByTestId('close-image-preview'))

    expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument()
  })

  it('should render download overlay when showDownloadAction is true', () => {
    const { container } = render(<FileImageItem file={createFile()} showDownloadAction />)

    expect(container.querySelector('[class*="bg-background-overlay-alt"]')).toBeInTheDocument()
    expect(screen.getByTestId('download-icon')).toBeInTheDocument()
  })

  it('should call downloadUrl when download button is clicked', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(<FileImageItem file={createFile()} showDownloadAction />)

    const downloadDiv = screen.getByTestId('download-icon').closest('div[class*="rounded-lg"]')
    fireEvent.click(downloadDiv!)

    expect(downloadUrl).toHaveBeenCalled()
  })

  it('should not render delete button when showDeleteAction is false', () => {
    render(<FileImageItem file={createFile()} />)

    expect(screen.queryByTestId('close-icon')).not.toBeInTheDocument()
  })
})
