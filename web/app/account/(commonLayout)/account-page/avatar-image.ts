import type { Area } from 'react-easy-crop'
import { createImage, getMimeType } from '@/app/components/base/app-icon-picker/utils'

const AVATAR_IMAGE_MAX_SIZE = 256
const AVATAR_IMAGE_QUALITY = 0.85

export const getBoundedAvatarImageSize = (
  crop: Pick<Area, 'width' | 'height'>,
  maxSize = AVATAR_IMAGE_MAX_SIZE,
) => {
  const scale = Math.min(1, maxSize / Math.max(crop.width, crop.height))

  return {
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
  }
}

export const createCroppedAvatarImage = async (
  imageSrc: string,
  pixelCrop: Area,
  fileName: string,
): Promise<Blob> => {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) throw new Error('Could not create a canvas context')

  const outputSize = getBoundedAvatarImageSize(pixelCrop)
  canvas.width = outputSize.width
  canvas.height = outputSize.height
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize.width,
    outputSize.height,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (file) => {
        if (file) resolve(file)
        else reject(new Error('Could not create a blob'))
      },
      getMimeType(fileName),
      AVATAR_IMAGE_QUALITY,
    )
  })
}
