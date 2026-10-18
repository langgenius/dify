import getCroppedImg, {
  checkIsAnimatedImage,
  createImage,
  getMimeType,
  rotateSize,
} from '../image-crop'

type ImageLoadEventType = 'load' | 'error'

class MockImageElement {
  static nextEvent: ImageLoadEventType = 'load'
  width = 320
  height = 160
  crossOriginValue = ''
  srcValue = ''
  private listeners: Record<string, EventListener[]> = {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const eventListener =
      typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(eventListener)
  }

  setAttribute(name: string, value: string) {
    if (name === 'crossOrigin') this.crossOriginValue = value
  }

  set src(value: string) {
    this.srcValue = value
    queueMicrotask(() => {
      const event = new Event(MockImageElement.nextEvent)
      for (const listener of this.listeners[MockImageElement.nextEvent] ?? []) listener(event)
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

const createCanvasMock = (
  context: CanvasRenderingContext2D | null,
  blob: Blob | null = new Blob(['ok']),
): CanvasMock => {
  const element = document.createElement('canvas')
  const getContextMock = vi.fn(() => context)
  const toBlobMock = vi.fn((callback: BlobCallback) => callback(blob))
  Object.defineProperties(element, {
    getContext: { value: getContextMock },
    toBlob: { value: toBlobMock },
  })
  return { element, getContextMock, toBlobMock }
}

const createCanvasContextMock = () => {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) throw new Error('The canvas test environment must provide a 2D context')
  vi.spyOn(context, 'translate')
  vi.spyOn(context, 'rotate')
  vi.spyOn(context, 'scale')
  vi.spyOn(context, 'drawImage').mockImplementation(() => {})
  return context
}

const createWebP = (chunks: ReadonlyArray<readonly [string, Uint8Array]>) => {
  const size =
    12 + chunks.reduce((total, [, payload]) => total + 8 + payload.length + (payload.length % 2), 0)
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  const encoder = new TextEncoder()
  bytes.set(encoder.encode('RIFF'), 0)
  view.setUint32(4, size - 8, true)
  bytes.set(encoder.encode('WEBP'), 8)
  let offset = 12
  for (const [type, payload] of chunks) {
    bytes.set(encoder.encode(type), offset)
    view.setUint32(offset + 4, payload.length, true)
    bytes.set(payload, offset + 8)
    offset += 8 + payload.length + (payload.length % 2)
  }
  return bytes
}

describe('utils', () => {
  const originalCreateElement = document.createElement.bind(document)

  beforeEach(() => {
    vi.clearAllMocks()
    MockImageElement.nextEvent = 'load'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const mockCanvasCreation = (canvases: HTMLCanvasElement[]) => {
    vi.spyOn(document, 'createElement').mockImplementation(
      (...args: Parameters<Document['createElement']>) => {
        if (args[0] === 'canvas') {
          const nextCanvas = canvases.shift()
          if (!nextCanvas) throw new Error('Unexpected canvas creation')
          return nextCanvas as ReturnType<Document['createElement']>
        }
        return originalCreateElement(...args)
      },
    )
  }

  describe('createImage', () => {
    it('should resolve image when load event fires', async () => {
      vi.stubGlobal('Image', MockImageElement)

      const image = await createImage('https://example.com/image.png')
      expect(image).toMatchObject({
        crossOriginValue: 'anonymous',
        src: 'https://example.com/image.png',
      })
    })

    it('should reject when error event fires', async () => {
      vi.stubGlobal('Image', MockImageElement)
      MockImageElement.nextEvent = 'error'

      await expect(createImage('https://example.com/broken.png')).rejects.toBeInstanceOf(Event)
    })
  })

  it.each([
    ['photo.png', 'image/png'],
    ['photo.PNG', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['animation.gif', 'image/gif'],
    ['photo.webp', 'image/webp'],
    ['file.bmp', 'image/jpeg'],
    ['file', 'image/jpeg'],
  ])('encodes %s as %s', (filename, mime) => {
    expect(getMimeType(filename)).toBe(mime)
  })

  it.each([
    [100, 200, 0, 100, 200],
    [100, 200, 90, 200, 100],
    [100, 200, -90, 200, 100],
    [100, 200, 180, 100, 200],
    [100, 100, 45, 141.421356, 141.421356],
  ])(
    'bounds a %s × %s image rotated %s degrees',
    (width, height, angle, expectedWidth, expectedHeight) => {
      const result = rotateSize(width, height, angle)
      expect(result.width).toBeCloseTo(expectedWidth)
      expect(result.height).toBeCloseTo(expectedHeight)
    },
  )

  describe('getCroppedImg', () => {
    it('should return a blob when canvas operations succeed', async () => {
      vi.stubGlobal('Image', MockImageElement)

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
      expect(sourceCanvas.element.width).toBeCloseTo(160)
      expect(sourceCanvas.element.height).toBeCloseTo(320)
      expect(croppedCanvas.element.width).toBe(50)
      expect(croppedCanvas.element.height).toBe(40)
      expect(sourceContext.translate).toHaveBeenLastCalledWith(-160, -80)
      expect(sourceContext.rotate).toHaveBeenCalledWith(Math.PI / 2)
      expect(sourceContext.scale).toHaveBeenCalledWith(-1, 1)
      expect(croppedContext.drawImage).toHaveBeenCalledWith(
        sourceCanvas.element,
        10,
        20,
        50,
        40,
        0,
        0,
        50,
        40,
      )
    })

    it('should apply vertical flip when vertical option is true', async () => {
      vi.stubGlobal('Image', MockImageElement)

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
      vi.stubGlobal('Image', MockImageElement)

      const sourceCanvas = createCanvasMock(null)
      mockCanvasCreation([sourceCanvas.element])

      await expect(
        getCroppedImg(
          'https://example.com/image.png',
          { x: 0, y: 0, width: 10, height: 10 },
          'avatar.png',
        ),
      ).rejects.toThrow('Could not create a canvas context')
    })

    it('should throw when cropped canvas context is unavailable', async () => {
      vi.stubGlobal('Image', MockImageElement)

      const sourceCanvas = createCanvasMock(createCanvasContextMock())
      const croppedCanvas = createCanvasMock(null)
      mockCanvasCreation([sourceCanvas.element, croppedCanvas.element])

      await expect(
        getCroppedImg(
          'https://example.com/image.png',
          { x: 0, y: 0, width: 10, height: 10 },
          'avatar.png',
        ),
      ).rejects.toThrow('Could not create a canvas context')
    })

    it('should reject when blob creation fails', async () => {
      vi.stubGlobal('Image', MockImageElement)

      const sourceCanvas = createCanvasMock(createCanvasContextMock())
      const croppedCanvas = createCanvasMock(createCanvasContextMock(), null)
      mockCanvasCreation([sourceCanvas.element, croppedCanvas.element])

      await expect(
        getCroppedImg(
          'https://example.com/image.jpg',
          { x: 0, y: 0, width: 10, height: 10 },
          'avatar.jpg',
        ),
      ).rejects.toThrow('Could not create a blob')
    })
  })

  describe('checkIsAnimatedImage', () => {
    it('should return true for .gif files', async () => {
      const gifFile = new File([new Uint8Array([0x47, 0x49, 0x46])], 'animation.gif', {
        type: 'image/gif',
      })
      const result = await checkIsAnimatedImage(gifFile)
      expect(result).toBe(true)
    })

    it('should return false for non-gif, non-webp files', async () => {
      const pngFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', {
        type: 'image/png',
      })
      const result = await checkIsAnimatedImage(pngFile)
      expect(result).toBe(false)
    })

    it.each([
      { name: 'animation chunk', chunks: [['ANIM', new Uint8Array(6)]] as const, animated: true },
      {
        name: 'animation after a padded chunk',
        chunks: [
          ['JUNK', new Uint8Array(1)],
          ['ANIM', new Uint8Array(6)],
        ] as const,
        animated: true,
      },
      { name: 'static image', chunks: [['VP8L', new Uint8Array(8)]] as const, animated: false },
      {
        name: 'ANIM text inside image payload',
        chunks: [['VP8L', new TextEncoder().encode('imageANIMdata')]] as const,
        animated: false,
      },
    ])('detects $name from chunk boundaries', async ({ chunks, animated }) => {
      const file = new File([createWebP(chunks)], 'image.webp', { type: 'image/webp' })
      await expect(checkIsAnimatedImage(file)).resolves.toBe(animated)
    })

    it('ignores data outside the declared RIFF container', async () => {
      const bytes = createWebP([['ANIM', new Uint8Array(6)]])
      new DataView(bytes.buffer).setUint32(4, 4, true)
      await expect(checkIsAnimatedImage(new File([bytes], 'image.webp'))).resolves.toBe(false)
    })

    it('does not accept a truncated animation chunk', async () => {
      const bytes = createWebP([['ANIM', new Uint8Array(6)]])
      new DataView(bytes.buffer).setUint32(16, 100, true)
      await expect(checkIsAnimatedImage(new File([bytes], 'image.webp'))).resolves.toBe(false)
    })

    it('should reject when FileReader encounters an error', async () => {
      const file = new File([], 'test.png', { type: 'image/png' })

      vi.stubGlobal(
        'FileReader',
        class {
          onerror: ((error: ProgressEvent<FileReader>) => void) | null = null
          onload: ((event: ProgressEvent<FileReader>) => void) | null = null

          readAsArrayBuffer(_blob: Blob) {
            const errorEvent = new ProgressEvent('error') as ProgressEvent<FileReader>
            setTimeout(() => {
              this.onerror?.(errorEvent)
            }, 0)
          }
        },
      )

      await expect(checkIsAnimatedImage(file)).rejects.toBeInstanceOf(ProgressEvent)
    })
  })
})
