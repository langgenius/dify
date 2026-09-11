import type { Area } from 'react-easy-crop'
import { createImage } from '@/app/components/base/app-icon-picker/utils'
import {
  createAvatarImageFile,
  createCroppedAvatarImage,
  getBoundedAvatarImageSize,
} from '../avatar-image'

vi.mock('@/app/components/base/app-icon-picker/utils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/components/base/app-icon-picker/utils')>()
  return {
    ...actual,
    createImage: vi.fn(),
  }
})

const mockedCreateImage = vi.mocked(createImage)

describe('avatar image', () => {
  describe('getBoundedAvatarImageSize', () => {
    it('downsamples a large square crop to 256 pixels', () => {
      expect(getBoundedAvatarImageSize({ width: 1000, height: 1000 })).toEqual({
        width: 256,
        height: 256,
      })
    })

    it('does not upscale a crop that is already within the bound', () => {
      expect(getBoundedAvatarImageSize({ width: 128, height: 128 })).toEqual({
        width: 128,
        height: 128,
      })
    })
  })

  it('draws the selected crop into a bounded high-quality canvas', async () => {
    const image = {} as HTMLImageElement
    const expectedBlob = new Blob(['avatar'], { type: 'image/png' })
    const context = {
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) => callback(expectedBlob)),
    } as unknown as HTMLCanvasElement
    vi.spyOn(document, 'createElement').mockReturnValue(canvas)
    mockedCreateImage.mockResolvedValue(image)
    const crop: Area = { x: 40, y: 20, width: 1000, height: 1000 }

    const result = await createCroppedAvatarImage('blob:avatar', crop, 'avatar.png')

    expect(result).toBe(expectedBlob)
    expect(canvas.width).toBe(256)
    expect(canvas.height).toBe(256)
    expect(context.imageSmoothingEnabled).toBe(true)
    expect(context.imageSmoothingQuality).toBe('high')
    expect(context.drawImage).toHaveBeenCalledWith(image, 40, 20, 1000, 1000, 0, 0, 256, 256)
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', 0.85)
  })

  it('matches the file extension to the browser output type', () => {
    const blob = new Blob(['avatar'], { type: 'image/png' })

    const file = createAvatarImageFile(blob, 'avatar.webp')

    expect(file.name).toBe('avatar.png')
    expect(file.type).toBe('image/png')
  })
})
