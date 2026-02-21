import type { useLocalFileUploader } from './hooks'
import type { ImageFile, VisionSettings } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Resolution, TransferMethod } from '@/types/app'
import TextGenerationImageUploader from './text-generation-image-uploader'

type LocalUploaderArgs = Parameters<typeof useLocalFileUploader>[0]

const mocks = vi.hoisted(() => ({
  files: [] as ImageFile[],
  onUpload: vi.fn<(imageFile: ImageFile) => void>(),
  onRemove: vi.fn<(imageFileId: string) => void>(),
  onImageLinkLoadError: vi.fn<(imageFileId: string) => void>(),
  onImageLinkLoadSuccess: vi.fn<(imageFileId: string) => void>(),
  onReUpload: vi.fn<(imageFileId: string) => void>(),
  handleLocalFileUpload: vi.fn<(file: File) => void>(),
  localUploaderArgs: undefined as LocalUploaderArgs | undefined,
}))

vi.mock('./hooks', () => ({
  useImageFiles: () => ({
    files: mocks.files,
    onUpload: mocks.onUpload,
    onRemove: mocks.onRemove,
    onImageLinkLoadError: mocks.onImageLinkLoadError,
    onImageLinkLoadSuccess: mocks.onImageLinkLoadSuccess,
    onReUpload: mocks.onReUpload,
  }),
  useLocalFileUploader: (args: LocalUploaderArgs) => {
    mocks.localUploaderArgs = args
    return {
      handleLocalFileUpload: mocks.handleLocalFileUpload,
    }
  },
}))

const createSettings = (overrides: Partial<VisionSettings> = {}): VisionSettings => ({
  enabled: true,
  number_limits: 3,
  detail: Resolution.high,
  transfer_methods: [TransferMethod.local_file],
  image_file_size_limit: 10,
  ...overrides,
})

describe('TextGenerationImageUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.files = []
    mocks.localUploaderArgs = undefined
  })

  describe('Rendering', () => {
    it('should render local upload action for local_file transfer method', () => {
      const onFilesChange = vi.fn()
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file],
      })

      render(<TextGenerationImageUploader settings={settings} onFilesChange={onFilesChange} />)

      expect(screen.getByText('common.imageUploader.uploadFromComputer')).toBeInTheDocument()
      expect(screen.queryByText('common.imageUploader.pasteImageLink')).not.toBeInTheDocument()
    })

    it('should render URL upload action for remote_url transfer method', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.remote_url],
      })

      render(<TextGenerationImageUploader settings={settings} onFilesChange={vi.fn()} />)

      expect(screen.getByText('common.imageUploader.pasteImageLink')).toBeInTheDocument()
      expect(screen.queryByText('common.imageUploader.uploadFromComputer')).not.toBeInTheDocument()
    })

    it('should render two-column grid when two transfer methods are enabled', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })
      render(<TextGenerationImageUploader settings={settings} onFilesChange={vi.fn()} />)

      const grid = screen.getByTestId('upload-actions')
      expect(grid).toHaveClass('grid-cols-2')
    })

    it('should render single-column grid when one transfer method is enabled', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file],
      })
      render(<TextGenerationImageUploader settings={settings} onFilesChange={vi.fn()} />)

      const grid = screen.getByTestId('upload-actions')
      expect(grid).toHaveClass('grid-cols-1')
    })

    it('should render no upload action for unsupported transfer method value', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.all],
      })

      render(<TextGenerationImageUploader settings={settings} onFilesChange={vi.fn()} />)

      expect(screen.queryByText('common.imageUploader.uploadFromComputer')).not.toBeInTheDocument()
      expect(screen.queryByText('common.imageUploader.pasteImageLink')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass numeric image size limit to local uploader hook', () => {
      const settings = createSettings({
        image_file_size_limit: '15',
        transfer_methods: [TransferMethod.local_file],
      })

      render(<TextGenerationImageUploader settings={settings} onFilesChange={vi.fn()} />)

      expect(mocks.localUploaderArgs?.limit).toBe(15)
    })

    it('should disable local uploader when disabled prop is true', () => {
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file],
      })
      render(
        <TextGenerationImageUploader
          settings={settings}
          onFilesChange={vi.fn()}
          disabled
        />,
      )

      const fileInput = screen.getByTestId('local-file-input')
      expect(fileInput).toBeDisabled()
      expect(mocks.localUploaderArgs?.disabled).toBe(true)
    })

    it('should disable upload actions when file count reaches number limit', async () => {
      const user = userEvent.setup()
      const settings = createSettings({
        number_limits: 1,
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })
      mocks.files = [{
        type: TransferMethod.remote_url,
        _id: 'file-1',
        fileId: 'id-1',
        progress: 100,
        url: 'https://example.com/image.png',
      }]
      render(<TextGenerationImageUploader settings={settings} onFilesChange={vi.fn()} />)

      const fileInput = screen.getByTestId('local-file-input')
      expect(fileInput).toBeDisabled()
      expect(mocks.localUploaderArgs?.disabled).toBe(true)

      await user.click(screen.getByText('common.imageUploader.pasteImageLink'))
      expect(screen.queryByPlaceholderText('common.imageUploader.pasteImageLinkInputPlaceholder')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call handleLocalFileUpload when a local file is selected', async () => {
      const user = userEvent.setup()
      const settings = createSettings({
        transfer_methods: [TransferMethod.local_file],
      })
      render(<TextGenerationImageUploader settings={settings} onFilesChange={vi.fn()} />)
      const fileInput = screen.getByTestId('local-file-input')
      const file = new File(['content'], 'sample.png', { type: 'image/png' })
      await user.upload(fileInput as HTMLInputElement, file)

      expect(mocks.handleLocalFileUpload).toHaveBeenCalledWith(file)
    })

    it('should open paste link popover and upload remote url', async () => {
      const user = userEvent.setup()
      const settings = createSettings({
        transfer_methods: [TransferMethod.remote_url],
      })

      render(<TextGenerationImageUploader settings={settings} onFilesChange={vi.fn()} />)

      await user.click(screen.getByText('common.imageUploader.pasteImageLink'))
      const input = await screen.findByPlaceholderText('common.imageUploader.pasteImageLinkInputPlaceholder')
      await user.type(input, 'https://example.com/remote.png')
      await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))

      expect(mocks.onUpload).toHaveBeenCalledWith(expect.objectContaining({
        type: TransferMethod.remote_url,
        url: 'https://example.com/remote.png',
        progress: 0,
      }))

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('common.imageUploader.pasteImageLinkInputPlaceholder')).not.toBeInTheDocument()
      })
    })
  })

  describe('Files Effect', () => {
    it('should call onFilesChange when files value changes', () => {
      const onFilesChange = vi.fn()
      const settings = createSettings()

      const { rerender } = render(<TextGenerationImageUploader settings={settings} onFilesChange={onFilesChange} />)
      expect(onFilesChange).toHaveBeenCalledWith([])

      const updatedFiles: ImageFile[] = [{
        type: TransferMethod.remote_url,
        _id: 'new-file',
        fileId: '',
        progress: 0,
        url: 'https://example.com/new.png',
      }]
      mocks.files = updatedFiles
      rerender(<TextGenerationImageUploader settings={settings} onFilesChange={onFilesChange} />)

      expect(onFilesChange).toHaveBeenCalledWith(updatedFiles)
    })
  })
})
