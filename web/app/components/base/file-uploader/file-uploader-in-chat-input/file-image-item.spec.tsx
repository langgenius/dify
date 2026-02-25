import type { FileEntity } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import FileImageItem from './file-image-item'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
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

  it('should render an image with the base64 URL', () => {
    render(<FileImageItem file={createFile()} />)

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc')
  })

  it('should use url when base64Url is not available', () => {
    render(<FileImageItem file={createFile({ base64Url: undefined })} />)

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/photo.png')
  })

  it('should render delete button when showDeleteAction is true', () => {
    render(<FileImageItem file={createFile()} showDeleteAction />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should call onRemove when delete button is clicked', () => {
    const onRemove = vi.fn()
    render(<FileImageItem file={createFile()} showDeleteAction onRemove={onRemove} />)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])

    expect(onRemove).toHaveBeenCalledWith('file-1')
  })

  it('should render progress circle when file is uploading', () => {
    const { container } = render(
      <FileImageItem file={createFile({ progress: 50, uploadedId: undefined })} />,
    )

    const svgs = container.querySelectorAll('svg')
    const progressSvg = Array.from(svgs).find(svg => svg.querySelector('circle'))
    expect(progressSvg).toBeInTheDocument()
  })

  it('should render replay icon when upload failed', () => {
    const { container } = render(<FileImageItem file={createFile({ progress: -1 })} />)

    // ReplayLine renders as an SVG icon with data-icon attribute
    const replaySvg = container.querySelector('svg[data-icon="ReplayLine"]')
    expect(replaySvg).toBeInTheDocument()
  })

  it('should call onReUpload when replay icon is clicked', () => {
    const onReUpload = vi.fn()
    const { container } = render(
      <FileImageItem file={createFile({ progress: -1 })} onReUpload={onReUpload} />,
    )

    const replaySvg = container.querySelector('svg[data-icon="ReplayLine"]')
    fireEvent.click(replaySvg!)

    expect(onReUpload).toHaveBeenCalledWith('file-1')
  })

  it('should show image preview when clicked and canPreview is true', () => {
    render(<FileImageItem file={createFile()} canPreview />)

    // Click the wrapper div (parent of the img element)
    const img = screen.getByRole('img')
    fireEvent.click(img.parentElement!)

    // ImagePreview renders via createPortal with class "image-preview-container", not role="dialog"
    expect(document.querySelector('.image-preview-container')).toBeInTheDocument()
  })

  it('should not show image preview when canPreview is false', () => {
    render(<FileImageItem file={createFile()} canPreview={false} />)

    const img = screen.getByRole('img')
    fireEvent.click(img.parentElement!)

    expect(document.querySelector('.image-preview-container')).not.toBeInTheDocument()
  })

  it('should close image preview when close is clicked', () => {
    render(<FileImageItem file={createFile()} canPreview />)

    const img = screen.getByRole('img')
    fireEvent.click(img.parentElement!)
    // ImagePreview renders via createPortal with class "image-preview-container"
    const previewContainer = document.querySelector('.image-preview-container')!
    expect(previewContainer).toBeInTheDocument()

    // Close button is the last clickable div with an SVG in the preview container
    const closeIcon = screen.getByTestId('image-preview-close-button')
    fireEvent.click(closeIcon.parentElement!)

    expect(document.querySelector('.image-preview-container')).not.toBeInTheDocument()
  })

  it('should render download overlay when showDownloadAction is true', () => {
    const { container } = render(<FileImageItem file={createFile()} showDownloadAction />)

    // The download icon SVG should be present
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(1)
  })

  it('should call downloadUrl when download button is clicked', async () => {
    const { downloadUrl } = await import('@/utils/download')
    const { container } = render(<FileImageItem file={createFile()} showDownloadAction />)

    // Find the RiDownloadLine SVG (it doesn't have data-icon attribute, unlike ReplayLine)
    const svgs = container.querySelectorAll('svg')
    const downloadSvg = Array.from(svgs).find(
      svg => !svg.hasAttribute('data-icon') && !svg.querySelector('circle'),
    )
    fireEvent.click(downloadSvg!.parentElement!)

    expect(downloadUrl).toHaveBeenCalled()
  })

  it('should not render delete button when showDeleteAction is false', () => {
    render(<FileImageItem file={createFile()} />)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('should use url when both base64Url and url fallback for image render', () => {
    render(<FileImageItem file={createFile({ base64Url: undefined, url: 'https://example.com/img.png' })} />)

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/img.png')
  })

  it('should render image element even when both base64Url and url are undefined', () => {
    render(<FileImageItem file={createFile({ base64Url: undefined, url: undefined })} />)

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
  })

  it('should use url with attachment param for download_url when url is available', async () => {
    const { downloadUrl } = await import('@/utils/download')
    const file = createFile({ url: 'https://example.com/photo.png' })
    const { container } = render(<FileImageItem file={file} showDownloadAction />)

    // The download SVG should be rendered
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(1)
    const downloadSvg = Array.from(svgs).find(
      svg => !svg.hasAttribute('data-icon') && !svg.querySelector('circle'),
    )
    fireEvent.click(downloadSvg!.parentElement!)
    expect(downloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('as_attachment=true'),
    }))
  })

  it('should use base64Url for download_url when url is not available', async () => {
    const { downloadUrl } = await import('@/utils/download')
    const file = createFile({ url: undefined, base64Url: 'data:image/png;base64,abc' })
    const { container } = render(<FileImageItem file={file} showDownloadAction />)

    const svgs = container.querySelectorAll('svg')
    const downloadSvg = Array.from(svgs).find(
      svg => !svg.hasAttribute('data-icon') && !svg.querySelector('circle'),
    )
    fireEvent.click(downloadSvg!.parentElement!)

    expect(downloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: 'data:image/png;base64,abc',
    }))
  })

  it('should set preview url using base64Url when available', () => {
    render(<FileImageItem file={createFile({ base64Url: 'data:image/png;base64,abc', url: 'https://example.com/photo.png' })} canPreview />)

    const img = screen.getByRole('img')
    fireEvent.click(img.parentElement!)

    expect(document.querySelector('.image-preview-container')).toBeInTheDocument()
  })

  it('should set preview url using url when base64Url is not available', () => {
    render(<FileImageItem file={createFile({ base64Url: undefined, url: 'https://example.com/photo.png' })} canPreview />)

    const img = screen.getByRole('img')
    fireEvent.click(img.parentElement!)

    expect(document.querySelector('.image-preview-container')).toBeInTheDocument()
  })

  it('should set preview url to empty string when both base64Url and url are undefined', () => {
    render(<FileImageItem file={createFile({ base64Url: undefined, url: undefined })} canPreview />)

    const img = screen.getByRole('img')
    fireEvent.click(img.parentElement!)

    // Preview won't show because imagePreviewUrl is empty string (falsy)
    expect(document.querySelector('.image-preview-container')).not.toBeInTheDocument()
  })

  it('should call downloadUrl with correct params when download button is clicked', async () => {
    const { downloadUrl } = await import('@/utils/download')
    const file = createFile({ url: 'https://example.com/photo.png', name: 'photo.png' })
    const { container } = render(<FileImageItem file={file} showDownloadAction />)

    const svgs = container.querySelectorAll('svg')
    const downloadSvg = Array.from(svgs).find(
      svg => !svg.hasAttribute('data-icon') && !svg.querySelector('circle'),
    )
    fireEvent.click(downloadSvg!.parentElement!)

    expect(downloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('as_attachment=true'),
      fileName: 'photo.png',
    }))
  })
})
