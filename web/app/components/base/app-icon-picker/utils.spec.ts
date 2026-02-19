import getCroppedImg, { checkIsAnimatedImage, createImage, getMimeType, getRadianAngle, rotateSize } from './utils'

type ImageLoadEventType = 'load' | 'error'

class MockImageElement {
  static nextEvent: ImageLoadEventType = 'load'
  width = 320
  height = 160
  crossOriginValue = ''
  srcValue = ''
  private listeners: Record<string, EventListener[]> = {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const eventListener = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    if (!this.listeners[type])
      this.listeners[type] = []
    this.listeners[type].push(eventListener)
  }

  setAttribute(name: string, value: string) {
    if (name === 'crossOrigin')
      this.crossOriginValue = value
  }

  set src(value: string) {
    this.srcValue = value
    queueMicrotask(() => {
      const event = new Event(MockImageElement.nextEvent)
      for (const listener of this.listeners[MockImageElement.nextEvent] ?? [])
        listener(event)
    })
  }

  get src() {
    return this.srcValue
  }
}

type CanvasMock = {
  element: HTMLCanvasElement
  getContextMock: ReturnType<typeof vi.fn>
  toBlobMock: ReturnType<typeof vi.fn>
}

const createCanvasMock = (context: CanvasRenderingContext2D | null, blob: Blob | null = new Blob(['ok'])): CanvasMock => {
  const getContextMock = vi.fn(() => context)
  const toBlobMock = vi.fn((callback: BlobCallback) => callback(blob))
  return {
    element: {
      width: 0,
      height: 0,
      getContext: getContextMock,
      toBlob: toBlobMock,
    } as unknown as HTMLCanvasElement,
    getContextMock,
    toBlobMock,
  }
}

const createCanvasContextMock = (): CanvasRenderingContext2D =>
  ({
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
  }) as unknown as CanvasRenderingContext2D

describe('utils', () => {
  const originalCreateElement = document.createElement.bind(document)
  let originalImage: typeof Image

  beforeEach(() => {
    vi.clearAllMocks()
    originalImage = globalThis.Image
    MockImageElement.nextEvent = 'load'
  })

  afterEach(() => {
    globalThis.Image = originalImage
    vi.restoreAllMocks()
  })

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

  describe('createImage', () => {
    it('should resolve image when load event fires', async () => {
      globalThis.Image = MockImageElement as unknown as typeof Image

      const image = await createImage('https://example.com/image.png')
      const mockImage = image as unknown as MockImageElement

      expect(mockImage.crossOriginValue).toBe('anonymous')
      expect(mockImage.src).toBe('https://example.com/image.png')
    })

    it('should reject when error event fires', async () => {
      globalThis.Image = MockImageElement as unknown as typeof Image
      MockImageElement.nextEvent = 'error'

      await expect(createImage('https://example.com/broken.png')).rejects.toBeInstanceOf(Event)
    })
  })

  describe('getMimeType', () => {
    it('should return image/png for .png files', () => {
      expect(getMimeType('photo.png')).toBe('image/png')
    })

    it('should return image/jpeg for .jpg files', () => {
      expect(getMimeType('photo.jpg')).toBe('image/jpeg')
    })

    it('should return image/jpeg for .jpeg files', () => {
      expect(getMimeType('photo.jpeg')).toBe('image/jpeg')
    })

    it('should return image/gif for .gif files', () => {
      expect(getMimeType('animation.gif')).toBe('image/gif')
    })

    it('should return image/webp for .webp files', () => {
      expect(getMimeType('photo.webp')).toBe('image/webp')
    })

    it('should return image/jpeg as default for unknown extensions', () => {
      expect(getMimeType('file.bmp')).toBe('image/jpeg')
    })

    it('should return image/jpeg for files with no extension', () => {
      expect(getMimeType('file')).toBe('image/jpeg')
    })

    it('should handle uppercase extensions via toLowerCase', () => {
      expect(getMimeType('photo.PNG')).toBe('image/png')
    })
  })

  describe('getRadianAngle', () => {
    it('should return 0 for 0 degrees', () => {
      expect(getRadianAngle(0)).toBe(0)
    })

    it('should return PI/2 for 90 degrees', () => {
      expect(getRadianAngle(90)).toBeCloseTo(Math.PI / 2)
    })

    it('should return PI for 180 degrees', () => {
      expect(getRadianAngle(180)).toBeCloseTo(Math.PI)
    })

    it('should return 2*PI for 360 degrees', () => {
      expect(getRadianAngle(360)).toBeCloseTo(2 * Math.PI)
    })

    it('should handle negative angles', () => {
      expect(getRadianAngle(-90)).toBeCloseTo(-Math.PI / 2)
    })
  })

  describe('rotateSize', () => {
    it('should return same dimensions for 0 degree rotation', () => {
      const result = rotateSize(100, 200, 0)
      expect(result.width).toBeCloseTo(100)
      expect(result.height).toBeCloseTo(200)
    })

    it('should swap dimensions for 90 degree rotation', () => {
      const result = rotateSize(100, 200, 90)
      expect(result.width).toBeCloseTo(200)
      expect(result.height).toBeCloseTo(100)
    })

    it('should return same dimensions for 180 degree rotation', () => {
      const result = rotateSize(100, 200, 180)
      expect(result.width).toBeCloseTo(100)
      expect(result.height).toBeCloseTo(200)
    })

    it('should handle square dimensions', () => {
      const result = rotateSize(100, 100, 45)
      // 45° rotation of a square produces a larger bounding box
      const expected = Math.abs(Math.cos(Math.PI / 4) * 100) + Math.abs(Math.sin(Math.PI / 4) * 100)
      expect(result.width).toBeCloseTo(expected)
      expect(result.height).toBeCloseTo(expected)
    })
  })

  describe('getCroppedImg', () => {
    it('should return a blob when canvas operations succeed', async () => {
      globalThis.Image = MockImageElement as unknown as typeof Image

      const sourceContext = createCanvasContextMock()
      const croppedContext = createCanvasContextMock()
      const sourceCanvas = createCanvasMock(sourceContext)
      const expectedBlob = new Blob(['cropped'], { type: 'image/webp' })
      const croppedCanvas = createCanvasMock(croppedContext, expectedBlob)
      mockCanvasCreation([sourceCanvas.element, croppedCanvas.element])

      const result = await getCroppedImg(
        'https://example.com/image.webp',
        { x: 10, y: 20, width: 50, height: 40 },
        'avatar.webp',
        90,
        { horizontal: true, vertical: false },
      )

      expect(result).toBe(expectedBlob)
      expect(croppedCanvas.toBlobMock).toHaveBeenCalledWith(expect.any(Function), 'image/webp')
      expect(sourceContext.translate).toHaveBeenCalled()
      expect(sourceContext.rotate).toHaveBeenCalled()
      expect(sourceContext.scale).toHaveBeenCalledWith(-1, 1)
      expect(croppedContext.drawImage).toHaveBeenCalled()
    })

    it('should apply vertical flip when vertical option is true', async () => {
      globalThis.Image = MockImageElement as unknown as typeof Image

      const sourceContext = createCanvasContextMock()
      const croppedContext = createCanvasContextMock()
      const sourceCanvas = createCanvasMock(sourceContext)
      const croppedCanvas = createCanvasMock(croppedContext)
      mockCanvasCreation([sourceCanvas.element, croppedCanvas.element])

      await getCroppedImg(
        'https://example.com/image.png',
        { x: 0, y: 0, width: 20, height: 20 },
        'avatar.png',
        0,
        { horizontal: false, vertical: true },
      )

      expect(sourceContext.scale).toHaveBeenCalledWith(1, -1)
    })

    it('should throw when source canvas context is unavailable', async () => {
      globalThis.Image = MockImageElement as unknown as typeof Image

      const sourceCanvas = createCanvasMock(null)
      mockCanvasCreation([sourceCanvas.element])

      await expect(
        getCroppedImg('https://example.com/image.png', { x: 0, y: 0, width: 10, height: 10 }, 'avatar.png'),
      ).rejects.toThrow('Could not create a canvas context')
    })

    it('should throw when cropped canvas context is unavailable', async () => {
      globalThis.Image = MockImageElement as unknown as typeof Image

      const sourceCanvas = createCanvasMock(createCanvasContextMock())
      const croppedCanvas = createCanvasMock(null)
      mockCanvasCreation([sourceCanvas.element, croppedCanvas.element])

      await expect(
        getCroppedImg('https://example.com/image.png', { x: 0, y: 0, width: 10, height: 10 }, 'avatar.png'),
      ).rejects.toThrow('Could not create a canvas context')
    })

    it('should reject when blob creation fails', async () => {
      globalThis.Image = MockImageElement as unknown as typeof Image

      const sourceCanvas = createCanvasMock(createCanvasContextMock())
      const croppedCanvas = createCanvasMock(createCanvasContextMock(), null)
      mockCanvasCreation([sourceCanvas.element, croppedCanvas.element])

      await expect(
        getCroppedImg('https://example.com/image.jpg', { x: 0, y: 0, width: 10, height: 10 }, 'avatar.jpg'),
      ).rejects.toThrow('Could not create a blob')
    })
  })

  describe('checkIsAnimatedImage', () => {
    let originalFileReader: typeof FileReader
    beforeEach(() => {
      originalFileReader = globalThis.FileReader
    })

    afterEach(() => {
      globalThis.FileReader = originalFileReader
    })
    it('should return true for .gif files', async () => {
      const gifFile = new File([new Uint8Array([0x47, 0x49, 0x46])], 'animation.gif', { type: 'image/gif' })
      const result = await checkIsAnimatedImage(gifFile)
      expect(result).toBe(true)
    })

    it('should return false for non-gif, non-webp files', async () => {
      const pngFile = new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], 'image.png', { type: 'image/png' })
      const result = await checkIsAnimatedImage(pngFile)
      expect(result).toBe(false)
    })

    it('should return true for animated WebP files with ANIM chunk', async () => {
      // Build a minimal WebP header with ANIM chunk
      // RIFF....WEBP....ANIM
      const bytes = new Uint8Array(20)
      // RIFF signature
      bytes[0] = 0x52 // R
      bytes[1] = 0x49 // I
      bytes[2] = 0x46 // F
      bytes[3] = 0x46 // F
      // WEBP signature
      bytes[8] = 0x57 // W
      bytes[9] = 0x45 // E
      bytes[10] = 0x42 // B
      bytes[11] = 0x50 // P
      // ANIM chunk at offset 12
      bytes[12] = 0x41 // A
      bytes[13] = 0x4E // N
      bytes[14] = 0x49 // I
      bytes[15] = 0x4D // M

      const webpFile = new File([bytes], 'animated.webp', { type: 'image/webp' })
      const result = await checkIsAnimatedImage(webpFile)
      expect(result).toBe(true)
    })

    it('should return false for static WebP files without ANIM chunk', async () => {
      const bytes = new Uint8Array(20)
      // RIFF signature
      bytes[0] = 0x52
      bytes[1] = 0x49
      bytes[2] = 0x46
      bytes[3] = 0x46
      // WEBP signature
      bytes[8] = 0x57
      bytes[9] = 0x45
      bytes[10] = 0x42
      bytes[11] = 0x50
      // No ANIM chunk

      const webpFile = new File([bytes], 'static.webp', { type: 'image/webp' })
      const result = await checkIsAnimatedImage(webpFile)
      expect(result).toBe(false)
    })

    it('should reject when FileReader encounters an error', async () => {
      const file = new File([], 'test.png', { type: 'image/png' })

      globalThis.FileReader = class {
        onerror: ((error: ProgressEvent<FileReader>) => void) | null = null
        onload: ((event: ProgressEvent<FileReader>) => void) | null = null

        readAsArrayBuffer(_blob: Blob) {
          const errorEvent = new ProgressEvent('error') as ProgressEvent<FileReader>
          setTimeout(() => {
            this.onerror?.(errorEvent)
          }, 0)
        }
      } as unknown as typeof FileReader

      await expect(checkIsAnimatedImage(file)).rejects.toBeInstanceOf(ProgressEvent)
    })
  })
})
