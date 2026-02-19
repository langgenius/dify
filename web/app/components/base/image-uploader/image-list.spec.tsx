import type { ImageFile } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import ImageList from './image-list'

const createLocalFile = (overrides: Partial<ImageFile> = {}): ImageFile => ({
  type: TransferMethod.local_file,
  _id: `local-${Date.now()}-${Math.random()}`,
  fileId: 'file-id',
  progress: 100,
  url: '',
  base64Url: 'data:image/png;base64,abc123',
  ...overrides,
})

const createRemoteFile = (overrides: Partial<ImageFile> = {}): ImageFile => ({
  type: TransferMethod.remote_url,
  _id: `remote-${Date.now()}-${Math.random()}`,
  fileId: '',
  progress: 100,
  url: 'https://example.com/image.png',
  ...overrides,
})

describe('ImageList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing with empty list', () => {
      render(<ImageList list={[]} />)
      expect(screen.getByTestId('image-list')).toBeInTheDocument()
    })

    it('should render images for each item in the list', () => {
      const list = [
        createLocalFile({ _id: 'file-1' }),
        createLocalFile({ _id: 'file-2' }),
      ]
      render(<ImageList list={list} />)

      const images = screen.getAllByRole('img')
      expect(images).toHaveLength(2)
    })

    it('should use base64Url as src for local files', () => {
      const list = [createLocalFile({ _id: 'file-1', base64Url: 'data:image/png;base64,xyz' })]
      render(<ImageList list={list} />)

      expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,xyz')
    })

    it('should use url as src for remote files', () => {
      const list = [createRemoteFile({ _id: 'file-1', url: 'https://example.com/img.jpg' })]
      render(<ImageList list={list} />)

      expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/img.jpg')
    })

    it('should set alt attribute from file name', () => {
      const file = new File(['test'], 'my-image.png', { type: 'image/png' })
      const list = [createLocalFile({ _id: 'file-1', file })]
      render(<ImageList list={list} />)

      expect(screen.getByRole('img')).toHaveAttribute('alt', 'my-image.png')
    })
  })

  describe('Props', () => {
    it('should show remove buttons when not readonly', () => {
      const list = [createLocalFile({ _id: 'file-1' })]
      render(<ImageList list={list} onRemove={vi.fn()} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should not show remove buttons when readonly', () => {
      const list = [createLocalFile({ _id: 'file-1' })]
      render(<ImageList list={list} readonly onRemove={vi.fn()} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('Local File Progress', () => {
    it('should show progress percentage when local file is uploading', () => {
      const list = [createLocalFile({ _id: 'file-1', progress: 45 })]
      render(<ImageList list={list} />)

      expect(screen.getByText(/^45\s*%$/)).toBeInTheDocument()
    })

    it('should not show progress overlay when local file is complete', () => {
      const list = [createLocalFile({ _id: 'file-1', progress: 100 })]
      render(<ImageList list={list} />)

      expect(screen.queryByText(/\d+\s*%/)).not.toBeInTheDocument()
    })

    it('should show retry icon when local file upload fails (progress -1)', () => {
      const onReUpload = vi.fn()
      const list = [createLocalFile({ _id: 'file-1', progress: -1 })]
      render(<ImageList list={list} onReUpload={onReUpload} />)

      expect(screen.getByTestId('retry-icon')).toBeInTheDocument()
      expect(screen.queryByText(/\d+\s*%/)).not.toBeInTheDocument()
    })
  })

  describe('Remote URL Progress', () => {
    it('should show loading spinner when remote file is loading (progress 0)', () => {
      const list = [createRemoteFile({ _id: 'file-1', progress: 0 })]
      render(<ImageList list={list} />)

      // Loading spinner has animate-spin class
      expect(screen.getByTestId('image-loader')).toBeInTheDocument()
    })

    it('should not show loading state when remote file is loaded (progress 100)', () => {
      const list = [createRemoteFile({ _id: 'file-1', progress: 100 })]
      render(<ImageList list={list} />)

      expect(screen.queryByTestId('image-loader')).not.toBeInTheDocument()
    })

    it('should show error indicator when remote file fails (progress -1)', () => {
      const list = [createRemoteFile({ _id: 'file-1', progress: -1 })]
      render(<ImageList list={list} />)
      expect(screen.getByTestId('image-error-container')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onRemove when remove button is clicked', async () => {
      const user = userEvent.setup()
      const onRemove = vi.fn()
      const list = [createLocalFile({ _id: 'file-1' })]
      render(<ImageList list={list} onRemove={onRemove} />)

      await user.click(screen.getByRole('button'))

      expect(onRemove).toHaveBeenCalledTimes(1)
      expect(onRemove).toHaveBeenCalledWith('file-1')
    })

    it('should call onReUpload when retry icon is clicked on failed local file', async () => {
      const user = userEvent.setup()
      const onReUpload = vi.fn()
      const list = [createLocalFile({ _id: 'file-1', progress: -1 })]
      render(<ImageList list={list} onReUpload={onReUpload} />)
      const retryIcon = screen.getByTestId('retry-icon')
      await user.click(retryIcon)
      expect(onReUpload).toHaveBeenCalledWith('file-1')
    })

    it('should open image preview when clicking a completed image', async () => {
      const user = userEvent.setup()
      const list = [createRemoteFile({ _id: 'file-1', progress: 100, url: 'https://example.com/img.png' })]
      render(<ImageList list={list} />)

      await user.click(screen.getByRole('img'))

      const preview = screen.getByTestId('image-preview-container')
      expect(preview).toBeInTheDocument()
    })

    it('should not open image preview when clicking an in-progress image', async () => {
      const user = userEvent.setup()
      const list = [createLocalFile({ _id: 'file-1', progress: 50 })]
      render(<ImageList list={list} />)

      await user.click(screen.getByRole('img'))

      expect(screen.queryByTestId('image-preview-container')).not.toBeInTheDocument()
    })

    it('should close image preview when cancel is clicked', async () => {
      const user = userEvent.setup()
      const list = [createRemoteFile({ _id: 'file-1', progress: 100 })]
      render(<ImageList list={list} />)

      // Open preview
      await user.click(screen.getByRole('img'))
      expect(screen.queryByTestId('image-preview-container')).toBeInTheDocument()

      // Close preview
      const closeButton = screen.getByTestId('image-preview-close-button')
      await user.click(closeButton)
      expect(screen.queryByTestId('image-preview-container')).not.toBeInTheDocument()
    })

    it('should open preview with base64Url for completed local file', async () => {
      const user = userEvent.setup()
      const list = [createLocalFile({ _id: 'file-1', progress: 100, base64Url: 'data:image/png;base64,localdata' })]
      render(<ImageList list={list} />)

      await user.click(screen.getByRole('img'))

      const previewImage = screen.getByTestId('image-preview-image')
      expect(previewImage).toBeInTheDocument()
      expect(previewImage).toHaveAttribute('src', 'data:image/png;base64,localdata')
    })
  })

  describe('Image Load Events', () => {
    it('should call onImageLinkLoadSuccess for remote URL on load when progress is not -1', () => {
      const onImageLinkLoadSuccess = vi.fn()
      const list = [createRemoteFile({ _id: 'file-1', progress: 0 })]
      render(<ImageList list={list} onImageLinkLoadSuccess={onImageLinkLoadSuccess} />)

      const img = screen.getByRole('img')
      fireEvent.load(img)
      expect(onImageLinkLoadSuccess).toHaveBeenCalledWith('file-1')
    })

    it('should not call onImageLinkLoadSuccess for remote URL when progress is -1', () => {
      const onImageLinkLoadSuccess = vi.fn()
      const list = [createRemoteFile({ _id: 'file-1', progress: -1 })]
      render(<ImageList list={list} onImageLinkLoadSuccess={onImageLinkLoadSuccess} />)

      const img = screen.getByRole('img')
      fireEvent.load(img)

      expect(onImageLinkLoadSuccess).not.toHaveBeenCalled()
    })

    it('should not call onImageLinkLoadSuccess for local file type', () => {
      const onImageLinkLoadSuccess = vi.fn()
      const list = [createLocalFile({ _id: 'file-1', progress: 50 })]
      render(<ImageList list={list} onImageLinkLoadSuccess={onImageLinkLoadSuccess} />)

      const img = screen.getByRole('img')
      fireEvent.load(img)

      expect(onImageLinkLoadSuccess).not.toHaveBeenCalled()
    })

    it('should call onImageLinkLoadError for remote URL on error', () => {
      const onImageLinkLoadError = vi.fn()
      const list = [createRemoteFile({ _id: 'file-1', progress: 0 })]
      render(<ImageList list={list} onImageLinkLoadError={onImageLinkLoadError} />)

      const img = screen.getByRole('img')
      fireEvent.error(img)

      expect(onImageLinkLoadError).toHaveBeenCalledWith('file-1')
    })

    it('should not call onImageLinkLoadError for local file type', () => {
      const onImageLinkLoadError = vi.fn()
      const list = [createLocalFile({ _id: 'file-1', progress: 50 })]
      render(<ImageList list={list} onImageLinkLoadError={onImageLinkLoadError} />)

      const img = screen.getByRole('img')
      fireEvent.error(img)

      expect(onImageLinkLoadError).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle list with mixed local and remote files', () => {
      const list = [
        createLocalFile({ _id: 'local-1' }),
        createRemoteFile({ _id: 'remote-1' }),
      ]
      render(<ImageList list={list} />)

      expect(screen.getAllByRole('img')).toHaveLength(2)
    })

    it('should handle item without file property for alt attribute', () => {
      const list = [createLocalFile({ _id: 'file-1', file: undefined })]
      render(<ImageList list={list} />)

      const img = screen.getByRole('img')
      expect(img).toBeInTheDocument()
    })

    it('should handle onRemove not provided gracefully', async () => {
      const user = userEvent.setup()
      const list = [createLocalFile({ _id: 'file-1' })]
      render(<ImageList list={list} />)

      // Button exists, clicking it should not throw
      await user.click(screen.getByRole('button'))
    })
  })
})
