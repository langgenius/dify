import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImagePreview from '../image-preview'

type _HotkeyHandler = () => void

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  downloadUrl: vi.fn(),
  windowOpen: vi.fn<(...args: unknown[]) => Window | null>(),
  clipboardWrite: vi.fn<(items: ClipboardItem[]) => Promise<void>>(),
}))

vi.mock('@/app/notifications', () => ({
  default: {
    notify: (...args: Parameters<typeof mocks.notify>) => mocks.notify(...args),
  },
  toast: {
    success: (message: string) => mocks.notify({ type: 'success', message }),
    error: (message: string) => mocks.notify({ type: 'error', message }),
    warning: (message: string) => mocks.notify({ type: 'warning', message }),
    info: (message: string) => mocks.notify({ type: 'info', message }),
  },
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: (...args: Parameters<typeof mocks.downloadUrl>) => mocks.downloadUrl(...args),
}))

const getOverlay = () => screen.getByTestId('image-preview-container') as HTMLDivElement
const getCloseButton = () =>
  screen.getByRole('button', { name: 'common.operation.cancel' }) as HTMLButtonElement
const getCopyButton = () =>
  screen.getByRole('button', { name: 'common.operation.copyImage' }) as HTMLButtonElement
const getZoomOutButton = () =>
  screen.getByRole('button', { name: 'common.operation.zoomOut' }) as HTMLButtonElement
const getZoomInButton = () =>
  screen.getByRole('button', { name: 'common.operation.zoomIn' }) as HTMLButtonElement
const getDownloadButton = () =>
  screen.getByRole('button', { name: 'common.operation.download' }) as HTMLButtonElement
const getOpenInTabButton = () =>
  screen.getByRole('button', { name: 'common.operation.openInNewTab' }) as HTMLButtonElement

const base64Image = 'aGVsbG8='
const dataImage = `data:image/png;base64,${base64Image}`

describe('ImagePreview', () => {
  const originalClipboardItem = globalThis.ClipboardItem

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () => new Response(new Blob(['image'], { type: 'image/png' }))),
    )

    if (!navigator.clipboard) {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: {
          write: vi.fn(),
        },
        writable: true,
        configurable: true,
      })
    }
    const clipboardTarget = navigator.clipboard as {
      write: (items: ClipboardItem[]) => Promise<void>
    }
    // In some test environments `write` lives on the prototype rather than
    // the clipboard instance itself; locate the actual owner so vi.spyOn
    // patches the right object.
    const writeOwner = Object.prototype.hasOwnProperty.call(clipboardTarget, 'write')
      ? clipboardTarget
      : (Object.getPrototypeOf(clipboardTarget) as {
          write: (items: ClipboardItem[]) => Promise<void>
        })
    vi.spyOn(writeOwner, 'write').mockImplementation((items: ClipboardItem[]) => {
      return mocks.clipboardWrite(items)
    })

    globalThis.ClipboardItem = class {
      public readonly data: Record<string, Blob | Promise<Blob>>

      constructor(data: Record<string, Blob | Promise<Blob>>) {
        this.data = data
      }
    } as unknown as typeof ClipboardItem
    vi.spyOn(window, 'open').mockImplementation((...args: Parameters<Window['open']>) => {
      return mocks.windowOpen(...args)
    })
  })

  afterEach(() => {
    globalThis.ClipboardItem = originalClipboardItem
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('Rendering', () => {
    it('should render preview in portal with image from url', () => {
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )

      const overlay = getOverlay()
      expect(overlay).toBeInTheDocument()
      expect(screen.getByTestId('image-preview-container')).not.toHaveAttribute('aria-label')
      expect(overlay.closest('[data-base-ui-portal]')?.parentElement).toBe(document.body)
      expect(screen.getByRole('img', { name: 'Preview Image' })).toHaveAttribute(
        'src',
        'https://example.com/image.png',
      )
    })

    it('should convert plain base64 string into data image src', () => {
      render(<ImagePreview url={base64Image} title="Preview Image" onCancel={vi.fn()} />)

      expect(screen.getByRole('img', { name: 'Preview Image' })).toHaveAttribute('src', dataImage)
    })
  })

  describe('Hotkeys', () => {
    it('should trigger esc/left/right handlers from keyboard', async () => {
      const onCancel = vi.fn()
      const onPrev = vi.fn()
      const onNext = vi.fn()
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={onCancel}
          onPrev={onPrev}
          onNext={onNext}
        />,
      )

      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
      fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft' })
      fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight' })

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onPrev).toHaveBeenCalledTimes(1)
      expect(onNext).toHaveBeenCalledTimes(1)
    })

    it('should zoom in and out from keyboard up/down hotkeys', async () => {
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )
      const image = screen.getByRole('img', { name: 'Preview Image' })

      fireEvent.keyDown(document, { key: 'ArrowUp', code: 'ArrowUp' })
      await waitFor(() => {
        expect(image).toHaveStyle({ transform: 'scale(1.2) translate(0px, 0px)' })
      })

      fireEvent.keyDown(document, { key: 'ArrowDown', code: 'ArrowDown' })
      await waitFor(() => {
        expect(image).toHaveStyle({ transform: 'scale(1) translate(0px, 0px)' })
      })
    })
  })

  describe('User Interactions', () => {
    it('should not close when image content is clicked', () => {
      const onCancel = vi.fn()
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={onCancel}
        />,
      )

      fireEvent.click(screen.getByRole('img', { name: 'Preview Image' }))

      expect(onCancel).not.toHaveBeenCalled()
    })

    it('should call onCancel when close button is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={onCancel}
        />,
      )

      const closeButton = getCloseButton()
      await user.click(closeButton)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should zoom in and out with wheel interactions', async () => {
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )
      const overlay = getOverlay()
      const image = screen.getByRole('img', { name: 'Preview Image' })

      act(() => {
        overlay.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
      })
      await waitFor(() => {
        expect(image).toHaveStyle({ transform: 'scale(1.2) translate(0px, 0px)' })
      })

      act(() => {
        overlay.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }))
      })
      await waitFor(() => {
        expect(image).toHaveStyle({ transform: 'scale(1) translate(0px, 0px)' })
      })
    })

    it('should update position while dragging when zoomed in and stop dragging on mouseup', async () => {
      const user = userEvent.setup()
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )

      const overlay = getOverlay()
      const image = screen.getByRole('img', { name: 'Preview Image' }) as HTMLImageElement
      const imageParent = image.parentElement
      if (!imageParent) throw new Error('Image parent element not found')

      vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 120,
        top: 0,
        left: 0,
        bottom: 120,
        right: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect)
      vi.spyOn(imageParent, 'getBoundingClientRect').mockReturnValue({
        width: 100,
        height: 100,
        top: 0,
        left: 0,
        bottom: 100,
        right: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect)

      const zoomInButton = getZoomInButton()
      await user.click(zoomInButton)

      act(() => {
        overlay.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }),
        )
      })
      await waitFor(() => {
        expect(image.style.transition).toBe('none')
      })

      act(() => {
        overlay.dispatchEvent(
          new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: -100 }),
        )
      })

      await waitFor(() => {
        expect(image).toHaveStyle({ transform: 'scale(1.2) translate(70px, -22px)' })
      })

      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })
      await waitFor(() => {
        expect(image.style.transition).toContain('transform 0.2s ease-in-out')
      })
    })
  })

  describe('Action Buttons', () => {
    it.each(['https://example.com/image.png', '/image-proxy/github/example'])(
      'should open valid url %s in new tab',
      async (url) => {
        const user = userEvent.setup()
        render(<ImagePreview url={url} title="Preview Image" onCancel={vi.fn()} />)

        const openInTabButton = getOpenInTabButton()
        await user.click(openInTabButton)

        expect(mocks.windowOpen).toHaveBeenCalledWith(url, '_blank')
      },
    )

    it('should open data image by writing to popup window document', async () => {
      const user = userEvent.setup()
      const write = vi.fn()
      mocks.windowOpen.mockReturnValue({
        document: {
          write,
        },
      } as unknown as Window)

      render(<ImagePreview url={dataImage} title="Preview Image" onCancel={vi.fn()} />)

      const openInTabButton = getOpenInTabButton()
      await user.click(openInTabButton)

      expect(mocks.windowOpen).toHaveBeenCalledWith()
      expect(write).toHaveBeenCalledWith(`<img src="${dataImage}" alt="Preview Image" />`)
    })

    it('should show error toast when opening unsupported url', async () => {
      const user = userEvent.setup()
      render(<ImagePreview url="file:///tmp/image.png" title="Preview Image" onCancel={vi.fn()} />)

      const openInTabButton = getOpenInTabButton()
      await user.click(openInTabButton)

      expect(mocks.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Unable to open image: file:///tmp/image.png',
      })
    })

    it('keeps the preview open and reports clipboard denial without downloading or navigating', async () => {
      const user = userEvent.setup()
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.clipboardWrite.mockRejectedValue(new Error('copy failed'))

      render(<ImagePreview url={dataImage} title="Preview Image" onCancel={vi.fn()} />)

      const copyButton = getCopyButton()
      await user.click(copyButton)

      await waitFor(() =>
        expect(mocks.notify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.operation.imageCopyFailed',
        }),
      )
      expect(mocks.downloadUrl).not.toHaveBeenCalled()
      expect(mocks.windowOpen).not.toHaveBeenCalled()
      expect(getOverlay()).toBeInTheDocument()
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })

    it('copies a remote PNG and starts the clipboard write before the image fetch resolves', async () => {
      const user = userEvent.setup()
      const png = new Blob(['png bytes'], { type: 'image/png' })
      let resolveFetch!: (response: Response) => void
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      )
      vi.stubGlobal('fetch', fetchMock)
      let copiedBlob: Blob | undefined
      mocks.clipboardWrite.mockImplementation(async ([item]) => {
        copiedBlob = await (item as unknown as { data: Record<string, Promise<Blob>> }).data[
          'image/png'
        ]
      })
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )

      await user.click(getCopyButton())

      expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1)
      expect(copiedBlob).toBeUndefined()
      resolveFetch(new Response(png))
      await waitFor(() =>
        expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })),
      )
      expect(copiedBlob?.type).toBe('image/png')
      expect(await copiedBlob?.text()).toBe('png bytes')
      expect(mocks.downloadUrl).not.toHaveBeenCalled()
    })

    it('converts a JPEG to PNG instead of labelling JPEG bytes as PNG', async () => {
      const user = userEvent.setup()
      const jpeg = new Blob(['jpeg bytes'], { type: 'image/jpeg' })
      const png = new Blob(['encoded png'], { type: 'image/png' })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(jpeg)))
      const bitmap = { width: 12, height: 8, close: vi.fn() }
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D)
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
        callback(png),
      )
      let copiedBlob: Blob | undefined
      mocks.clipboardWrite.mockImplementation(async ([item]) => {
        copiedBlob = await (item as unknown as { data: Record<string, Promise<Blob>> }).data[
          'image/png'
        ]
      })
      render(
        <ImagePreview
          url="https://example.com/image.jpg"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )

      await user.click(getCopyButton())

      await waitFor(() => expect(copiedBlob).toBe(png))
      expect(bitmap.close).toHaveBeenCalled()
      expect(mocks.downloadUrl).not.toHaveBeenCalled()
    })

    it('reports an image fetch failure without leaving the preview', async () => {
      const user = userEvent.setup()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
      mocks.clipboardWrite.mockImplementation(async ([item]) => {
        await (item as unknown as { data: Record<string, Promise<Blob>> }).data['image/png']
      })
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )

      await user.click(getCopyButton())

      await waitFor(() =>
        expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
      )
      expect(mocks.downloadUrl).not.toHaveBeenCalled()
      expect(mocks.windowOpen).not.toHaveBeenCalled()
      expect(getOverlay()).toBeInTheDocument()
    })

    it('should copy image and show success toast', async () => {
      const user = userEvent.setup()
      mocks.clipboardWrite.mockResolvedValue()
      render(<ImagePreview url={dataImage} title="Preview Image" onCancel={vi.fn()} />)

      const copyButton = getCopyButton()
      await user.click(copyButton)

      await waitFor(() => {
        expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1)
      })
      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
        }),
      )
    })

    it.each(['https://example.com/image.png', '/image-proxy/github/example'])(
      'should download valid url %s',
      async (url) => {
        const user = userEvent.setup()
        render(<ImagePreview url={url} title="Preview Image" onCancel={vi.fn()} />)
        const downloadButton = getDownloadButton()
        await user.click(downloadButton)

        expect(mocks.downloadUrl).toHaveBeenCalledWith({
          url,
          fileName: 'Preview Image',
          target: '_blank',
        })
      },
    )

    it('should show error toast for invalid download url', async () => {
      const user = userEvent.setup()
      render(<ImagePreview url="invalid://image.png" title="Preview Image" onCancel={vi.fn()} />)
      const downloadButton = getDownloadButton()
      await user.click(downloadButton)

      expect(mocks.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Unable to open image: invalid://image.png',
      })
    })

    it('should zoom with dedicated zoom buttons', async () => {
      const user = userEvent.setup()
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )
      const image = screen.getByRole('img', { name: 'Preview Image' })

      const zoomInButton = getZoomInButton()
      const zoomOutButton = getZoomOutButton()
      await user.click(zoomInButton)
      await waitFor(() => {
        expect(image).toHaveStyle({ transform: 'scale(1.2) translate(0px, 0px)' })
      })

      await user.click(zoomOutButton)
      await waitFor(() => {
        expect(image).toHaveStyle({ transform: 'scale(1) translate(0px, 0px)' })
      })
    })

    it('should zoom out below 1 without resetting position', async () => {
      const user = userEvent.setup()
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )
      const image = screen.getByRole('img', { name: 'Preview Image' })

      await user.click(getZoomOutButton())
      await waitFor(() => {
        expect(image).toHaveStyle({ transform: 'scale(0.8333333333333334) translate(0px, 0px)' })
      })
    })

    it('should keep drag move stable when rect data is unavailable', async () => {
      const user = userEvent.setup()
      render(
        <ImagePreview
          url="https://example.com/image.png"
          title="Preview Image"
          onCancel={vi.fn()}
        />,
      )

      const overlay = getOverlay()
      const image = screen.getByRole('img', { name: 'Preview Image' }) as HTMLImageElement
      const imageParent = image.parentElement
      if (!imageParent) throw new Error('Image parent element not found')

      vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(undefined as unknown as DOMRect)
      vi.spyOn(imageParent, 'getBoundingClientRect').mockReturnValue(
        undefined as unknown as DOMRect,
      )

      await user.click(getZoomInButton())
      act(() => {
        overlay.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }),
        )
        overlay.dispatchEvent(
          new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 60 }),
        )
      })

      expect(image).toHaveStyle({ transform: 'scale(1.2) translate(0px, 0px)' })
    })
  })
})
