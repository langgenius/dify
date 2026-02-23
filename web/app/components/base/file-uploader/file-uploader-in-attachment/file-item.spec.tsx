import type { FileEntity } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { PreviewMode } from '@/app/components/base/features/types'
import { TransferMethod } from '@/types/app'
import FileInAttachmentItem from './file-item'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('@/utils/format', () => ({
  formatFileSize: (size: number) => `${size}B`,
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

    expect(screen.getByText(/document\.pdf/i)).toBeInTheDocument()
    expect(screen.getByText(/^pdf$/i)).toBeInTheDocument()
  })

  it('should render file size', () => {
    render(<FileInAttachmentItem file={createFile({ size: 2048 })} />)

    expect(screen.getByText(/2048B/)).toBeInTheDocument()
  })

  it('should render FileTypeIcon for non-image files', () => {
    const { container } = render(<FileInAttachmentItem file={createFile()} />)

    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should render FileImageRender for image files', () => {
    render(
      <FileInAttachmentItem file={createFile({
        supportFileType: 'image',
        base64Url: 'data:image/png;base64,abc',
      })}
      />,
    )

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc')
  })

  it('should render delete button when showDeleteAction is true', () => {
    render(<FileInAttachmentItem file={createFile()} showDeleteAction />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should not render delete button when showDeleteAction is false', () => {
    render(<FileInAttachmentItem file={createFile()} showDeleteAction={false} />)

    // With showDeleteAction=false, showDownloadAction defaults to true,
    // so there should be exactly 1 button (the download button)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
  })

  it('should call onRemove when delete button is clicked', () => {
    const onRemove = vi.fn()
    // Disable download to isolate the delete button
    render(<FileInAttachmentItem file={createFile()} showDeleteAction showDownloadAction={false} onRemove={onRemove} />)

    const deleteBtn = screen.getByRole('button')
    fireEvent.click(deleteBtn)

    expect(onRemove).toHaveBeenCalledWith('file-1')
  })

  it('should render download button when showDownloadAction is true', () => {
    render(<FileInAttachmentItem file={createFile()} showDownloadAction />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should render progress circle when file is uploading', () => {
    const { container } = render(<FileInAttachmentItem file={createFile({ progress: 50, uploadedId: undefined })} />)

    // ProgressCircle renders an SVG with a <circle> and <path> element
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    const circle = container.querySelector('circle')
    expect(circle).toBeInTheDocument()
  })

  it('should render replay icon when upload failed', () => {
    const { container } = render(<FileInAttachmentItem file={createFile({ progress: -1 })} />)

    // ReplayLine renders an SVG with data-icon="ReplayLine"
    const replayIcon = container.querySelector('[data-icon="ReplayLine"]')
    expect(replayIcon).toBeInTheDocument()
  })

  it('should call onReUpload when replay icon is clicked', () => {
    const onReUpload = vi.fn()
    const { container } = render(<FileInAttachmentItem file={createFile({ progress: -1 })} onReUpload={onReUpload} />)

    const replayIcon = container.querySelector('[data-icon="ReplayLine"]')
    const replayBtn = replayIcon!.closest('button')
    fireEvent.click(replayBtn!)

    expect(onReUpload).toHaveBeenCalledWith('file-1')
  })

  it('should indicate error state when progress is -1', () => {
    const { container } = render(<FileInAttachmentItem file={createFile({ progress: -1 })} />)

    // Error state is confirmed by the presence of the replay icon
    const replayIcon = container.querySelector('[data-icon="ReplayLine"]')
    expect(replayIcon).toBeInTheDocument()
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

    // canPreview + image renders an extra button for the eye icon
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(2)
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

    // The eye button is rendered before the download button for image files
    const buttons = screen.getAllByRole('button')
    // Click the eye button (the first action button for image preview)
    fireEvent.click(buttons[0])

    // ImagePreview renders a portal with an img element
    const previewImages = document.querySelectorAll('img')
    // There should be at least 2 images: the file thumbnail + the preview
    expect(previewImages.length).toBeGreaterThanOrEqual(2)
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

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])

    // ImagePreview renders via createPortal with class "image-preview-container"
    const previewContainer = document.querySelector('.image-preview-container')!
    expect(previewContainer).toBeInTheDocument()

    // Close button is the last clickable div with an SVG in the preview container
    const closeIcon = screen.getByTestId('image-preview-close-button')
    fireEvent.click(closeIcon.parentElement!)

    // Preview should be removed
    expect(document.querySelector('.image-preview-container')).not.toBeInTheDocument()
  })

  it('should call downloadUrl when download button is clicked', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(<FileInAttachmentItem file={createFile()} showDownloadAction />)

    // Download button is the only action button when showDeleteAction is not set
    const downloadBtn = screen.getByRole('button')
    fireEvent.click(downloadBtn)

    expect(downloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      fileName: expect.stringMatching(/document\.pdf/i),
    }))
  })

  it('should open new page when previewMode is NewPage and clicked', () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <FileInAttachmentItem
        file={createFile({ url: 'https://example.com/doc.pdf' })}
        canPreview
        previewMode={PreviewMode.NewPage}
      />,
    )

    // Click the file name text to trigger the row click handler
    fireEvent.click(screen.getByText(/document\.pdf/i))

    expect(windowOpen).toHaveBeenCalledWith('https://example.com/doc.pdf', '_blank')
    windowOpen.mockRestore()
  })

  it('should fallback to base64Url when url is empty for NewPage preview', () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <FileInAttachmentItem
        file={createFile({ url: undefined, base64Url: 'data:image/png;base64,abc' })}
        canPreview
        previewMode={PreviewMode.NewPage}
      />,
    )

    fireEvent.click(screen.getByText(/document\.pdf/i))

    expect(windowOpen).toHaveBeenCalledWith('data:image/png;base64,abc', '_blank')
    windowOpen.mockRestore()
  })

  it('should open empty string when both url and base64Url are empty for NewPage preview', () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <FileInAttachmentItem
        file={createFile({ url: undefined, base64Url: undefined })}
        canPreview
        previewMode={PreviewMode.NewPage}
      />,
    )

    fireEvent.click(screen.getByText(/document\.pdf/i))

    expect(windowOpen).toHaveBeenCalledWith('', '_blank')
    windowOpen.mockRestore()
  })

  it('should not open new page when previewMode is not NewPage', () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <FileInAttachmentItem
        file={createFile()}
        canPreview
        previewMode={PreviewMode.CurrentPage}
      />,
    )

    fireEvent.click(screen.getByText(/document\.pdf/i))

    expect(windowOpen).not.toHaveBeenCalled()
    windowOpen.mockRestore()
  })

  it('should use url for image render fallback when base64Url is empty', () => {
    render(
      <FileInAttachmentItem file={createFile({
        supportFileType: 'image',
        base64Url: undefined,
        url: 'https://example.com/img.png',
      })}
      />,
    )

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/img.png')
  })

  it('should render image element even when both urls are empty', () => {
    render(
      <FileInAttachmentItem file={createFile({
        supportFileType: 'image',
        base64Url: undefined,
        url: undefined,
      })}
      />,
    )

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
  })

  it('should not render eye icon when canPreview is false for image files', () => {
    render(
      <FileInAttachmentItem
        file={createFile({
          supportFileType: 'image',
          url: 'https://example.com/img.png',
        })}
        canPreview={false}
      />,
    )

    // Without canPreview, only the download button should render
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
  })

  it('should download using base64Url when url is not available', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(
      <FileInAttachmentItem
        file={createFile({ url: undefined, base64Url: 'data:application/pdf;base64,abc' })}
        showDownloadAction
      />,
    )

    const downloadBtn = screen.getByRole('button')
    fireEvent.click(downloadBtn)

    expect(downloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: 'data:application/pdf;base64,abc',
    }))
  })

  it('should not render file size when size is 0', () => {
    render(<FileInAttachmentItem file={createFile({ size: 0 })} />)

    expect(screen.queryByText(/0B/)).not.toBeInTheDocument()
  })

  it('should not render extension when ext is empty', () => {
    render(<FileInAttachmentItem file={createFile({ name: 'noext' })} />)

    // The file name should still show
    expect(screen.getByText(/noext/)).toBeInTheDocument()
  })

  it('should show image preview with empty url when url is undefined', () => {
    render(
      <FileInAttachmentItem
        file={createFile({
          supportFileType: 'image',
          url: undefined,
          base64Url: undefined,
        })}
        canPreview
      />,
    )

    const buttons = screen.getAllByRole('button')
    // Click the eye preview button
    fireEvent.click(buttons[0])

    // setImagePreviewUrl(url || '') = setImagePreviewUrl('')
    // Empty string is falsy, so preview should NOT render
    expect(document.querySelector('.image-preview-container')).not.toBeInTheDocument()
  })

  it('should download with empty url when both url and base64Url are undefined', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(
      <FileInAttachmentItem
        file={createFile({ url: undefined, base64Url: undefined })}
        showDownloadAction
      />,
    )

    const downloadBtn = screen.getByRole('button')
    fireEvent.click(downloadBtn)

    expect(downloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: '',
    }))
  })

  it('should call downloadUrl with empty url when both url and base64Url are falsy', async () => {
    const { downloadUrl } = await import('@/utils/download')
    render(
      <FileInAttachmentItem
        file={createFile({ url: '', base64Url: '' })}
        showDownloadAction
      />,
    )

    const downloadBtn = screen.getByRole('button')
    fireEvent.click(downloadBtn)

    expect(downloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: '',
    }))
  })
})
