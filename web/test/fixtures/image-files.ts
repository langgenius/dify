/** Small, decodable files shared by image input, crop and clipboard scenarios. */
import gifDataUrl from './media/preview.gif?url&inline'

export function createGifFile(name = 'icon.gif') {
  const bytes = Uint8Array.from(atob(gifDataUrl.split(',')[1]!), (character) =>
    character.charCodeAt(0),
  )
  return new File([bytes], name, { type: 'image/gif' })
}

export async function createImageFile({
  name = 'photo.png',
  type = 'image/png',
  width = 120,
  height = 80,
} = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = 'red'
  context.fillRect(0, 0, width / 2, height)
  context.fillStyle = 'blue'
  context.fillRect(width / 2, 0, width / 2, height)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('Image encoding failed'))),
      type,
    ),
  )
  return new File([blob], name, { type })
}

export async function readImagePixels(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    return {
      width: bitmap.width,
      height: bitmap.height,
      left: [
        ...context.getImageData(Math.floor(bitmap.width / 4), Math.floor(bitmap.height / 2), 1, 1)
          .data,
      ],
      right: [
        ...context.getImageData(
          Math.floor((bitmap.width * 3) / 4),
          Math.floor(bitmap.height / 2),
          1,
          1,
        ).data,
      ],
    }
  } finally {
    bitmap.close()
  }
}
