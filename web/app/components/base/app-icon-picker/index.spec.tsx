import type { Area } from 'react-easy-crop'
import type { ImageFile } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import AppIconPicker from './index'
import 'vitest-canvas-mock'

type LocalFileUploaderOptions = {
  disabled?: boolean
  limit?: number
  onUpload: (imageFile: ImageFile) => void
}

class MockLoadedImage {
  width = 320
  height = 160
  private listeners: Record<string, EventListener[]> = {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const eventListener = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    if (!this.listeners[type])
      this.listeners[type] = []
    this.listeners[type].push(eventListener)
  }

  setAttribute(_name: string, _value: string) { }

  set src(_value: string) {
    queueMicrotask(() => {
      for (const listener of this.listeners.load ?? [])
        listener(new Event('load'))
    })
  }

  get src() {
    return ''
  }
}

const createImageFile = (overrides: Partial<ImageFile> = {}): ImageFile => ({
  type: TransferMethod.local_file,
  _id: 'test-image-id',
  fileId: 'uploaded-image-id',
  progress: 100,
  url: 'https://example.com/uploaded.png',
  ...overrides,
})

const createCanvasContextMock = (): CanvasRenderingContext2D =>
  ({
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
  }) as unknown as CanvasRenderingContext2D

const createCanvasElementMock = (context: CanvasRenderingContext2D | null, blob: Blob | null = new Blob(['ok'], { type: 'image/png' })) =>
  ({
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => callback(blob)),
  }) as unknown as HTMLCanvasElement

const mocks = vi.hoisted(() => ({
  disableUpload: false,
  uploadResult: null as ImageFile | null,
  onUpload: null as ((imageFile: ImageFile) => void) | null,
  handleLocalFileUpload: vi.fn<(file: File) => void>(),
}))

vi.mock('@/config', () => ({
  get DISABLE_UPLOAD_IMAGE_AS_ICON() {
    return mocks.disableUpload
  },
}))

vi.mock('react-easy-crop', () => ({
  default: ({ onCropComplete }: { onCropComplete: (_area: Area, croppedAreaPixels: Area) => void }) => (
    <div data-testid="mock-cropper">
      <button
        type="button"
        data-testid="trigger-crop"
        onClick={() => onCropComplete(
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 0, y: 0, width: 100, height: 100 },
        )}
      >
        Trigger Crop
      </button>
    </div>
  ),
}))

vi.mock('../image-uploader/hooks', () => ({
  useLocalFileUploader: (options: LocalFileUploaderOptions) => {
    mocks.onUpload = options.onUpload
    return { handleLocalFileUpload: mocks.handleLocalFileUpload }
  },
}))

vi.mock('@/utils/emoji', () => ({
  searchEmoji: vi.fn().mockResolvedValue(['grinning', 'sunglasses']),
}))

describe('AppIconPicker', () => {
  const originalCreateElement = document.createElement.bind(document)
  const originalCreateObjectURL = globalThis.URL.createObjectURL
  const originalRevokeObjectURL = globalThis.URL.revokeObjectURL
  let originalImage: typeof Image

  const mockCanvasCreation = (canvases: HTMLCanvasElement[]) => {
    vi.spyOn(document, 'createElement').mockImplementation((...args: Parameters<Document['createElement']>) => {
      if (args[0] === 'canvas') {
        const nextCanvas = canvases.shift()
        if (!nextCanvas)
          throw new Error('Unexpected canvas creation')
        return nextCanvas as ReturnType<Document['createElement']>
      }
      return originalCreateElement(...args)
    })
  }

  const renderPicker = () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    const { container } = render(<AppIconPicker onSelect={onSelect} onClose={onClose} />)

    return { onSelect, onClose, container }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.disableUpload = false
    mocks.uploadResult = createImageFile()
    mocks.onUpload = null
    mocks.handleLocalFileUpload.mockImplementation(() => {
      if (mocks.uploadResult)
        mocks.onUpload?.(mocks.uploadResult)
    })

    originalImage = globalThis.Image
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    globalThis.Image = originalImage
    globalThis.URL.createObjectURL = originalCreateObjectURL
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL
  })

  describe('Rendering', () => {
    it('should render emoji and image tabs when upload is enabled', async () => {
      renderPicker()

      expect(await screen.findByText(/emoji/i)).toBeInTheDocument()
      expect(screen.getByText(/image/i)).toBeInTheDocument()
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()
      expect(screen.getByText(/ok/i)).toBeInTheDocument()
    })

    it('should hide the image tab when upload is disabled', () => {
      mocks.disableUpload = true
      renderPicker()

      expect(screen.queryByText(/image/i)).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClose when cancel is clicked', async () => {
      const { onClose } = renderPicker()

      await userEvent.click(screen.getByText(/cancel/i))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should switch between emoji and image tabs', async () => {
      renderPicker()

      await userEvent.click(screen.getByText(/image/i))
      expect(screen.getByText(/drop.*here/i)).toBeInTheDocument()

      await userEvent.click(screen.getByText(/emoji/i))
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    })

    it('should call onSelect with emoji data after emoji selection', async () => {
      const { onSelect } = renderPicker()

      await waitFor(() => {
        expect(screen.queryAllByTestId(/emoji-container-/i).length).toBeGreaterThan(0)
      })

      const firstEmoji = screen.queryAllByTestId(/emoji-container-/i)[0]
      if (!firstEmoji)
        throw new Error('Could not find emoji option')

      await userEvent.click(firstEmoji)
      await userEvent.click(screen.getByText(/ok/i))

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
          type: 'emoji',
          icon: expect.any(String),
          background: expect.any(String),
        }))
      })
    })

    it('should not call onSelect when no emoji has been selected', async () => {
      const { onSelect } = renderPicker()

      await userEvent.click(screen.getByText(/ok/i))

      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('Image Upload', () => {
    it('should return early when image tab is active and no file has been selected', async () => {
      const { onSelect } = renderPicker()

      await userEvent.click(screen.getByText(/image/i))
      await userEvent.click(screen.getByText(/ok/i))

      expect(mocks.handleLocalFileUpload).not.toHaveBeenCalled()
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('should upload cropped static image and emit selected image metadata', async () => {
      globalThis.Image = MockLoadedImage as unknown as typeof Image

      const sourceCanvas = createCanvasElementMock(createCanvasContextMock())
      const croppedBlob = new Blob(['cropped-image'], { type: 'image/png' })
      const croppedCanvas = createCanvasElementMock(createCanvasContextMock(), croppedBlob)
      mockCanvasCreation([sourceCanvas, croppedCanvas])

      const { onSelect } = renderPicker()
      await userEvent.click(screen.getByText(/image/i))

      const input = screen.queryByTestId('image-input')
      if (!input)
        throw new Error('Could not find image input')

      fireEvent.change(input, { target: { files: [new File(['png'], 'avatar.png', { type: 'image/png' })] } })

      await waitFor(() => {
        expect(screen.getByTestId('mock-cropper')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByTestId('trigger-crop'))
      await userEvent.click(screen.getByText(/ok/i))

      await waitFor(() => {
        expect(mocks.handleLocalFileUpload).toHaveBeenCalledTimes(1)
      })

      const uploadedFile = mocks.handleLocalFileUpload.mock.calls[0][0]
      expect(uploadedFile).toBeInstanceOf(File)
      expect(uploadedFile.name).toBe('avatar.png')
      expect(uploadedFile.type).toBe('image/png')

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith({
          type: 'image',
          fileId: 'uploaded-image-id',
          url: 'https://example.com/uploaded.png',
        })
      })
    })

    it('should upload animated image directly without crop', async () => {
      const { onSelect } = renderPicker()
      await userEvent.click(screen.getByText(/image/i))

      const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      const gifFile = new File([gifBytes], 'animated.gif', { type: 'image/gif' })

      const input = screen.queryByTestId('image-input')
      if (!input)
        throw new Error('Could not find image input')

      fireEvent.change(input, { target: { files: [gifFile] } })

      await waitFor(() => {
        expect(screen.queryByTestId('mock-cropper')).not.toBeInTheDocument()
        const preview = screen.queryByTestId('animated-image')
        expect(preview).toBeInTheDocument()
        expect(preview?.getAttribute('src')).toContain('blob:mock-url')
      })

      await userEvent.click(screen.getByText(/ok/i))

      await waitFor(() => {
        expect(mocks.handleLocalFileUpload).toHaveBeenCalledWith(gifFile)
      })

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith({
          type: 'image',
          fileId: 'uploaded-image-id',
          url: 'https://example.com/uploaded.png',
        })
      })
    })

    it('should not call onSelect when upload callback returns image without fileId', async () => {
      mocks.uploadResult = createImageFile({ fileId: '' })
      const { onSelect } = renderPicker()
      await userEvent.click(screen.getByText(/image/i))

      const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      const gifFile = new File([gifBytes], 'no-file-id.gif', { type: 'image/gif' })

      const input = screen.queryByTestId('image-input')
      if (!input)
        throw new Error('Could not find image input')

      fireEvent.change(input, { target: { files: [gifFile] } })

      await waitFor(() => {
        expect(screen.queryByTestId('mock-cropper')).not.toBeInTheDocument()
      })

      await userEvent.click(screen.getByText(/ok/i))

      await waitFor(() => {
        expect(mocks.handleLocalFileUpload).toHaveBeenCalledWith(gifFile)
      })
      expect(onSelect).not.toHaveBeenCalled()
    })
  })
})
