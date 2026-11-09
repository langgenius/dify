import type { ImageFile } from '@/types/app'
import { TransferMethod } from '@/types/app'

// A decodable 1×1 PNG: image rendering and FileReader stay real without network traffic.
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aen0AAAAASUVORK5CYII='
export const imageUrl = `data:image/png;base64,${png}`
export const brokenImageUrl = 'data:image/png;base64,broken'
export const imageFile = () =>
  new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'sample.png', {
    type: 'image/png',
  })

export const localImage = (overrides: Partial<ImageFile> = {}): ImageFile => ({
  type: TransferMethod.local_file,
  _id: 'local-image',
  fileId: 'uploaded-image',
  file: imageFile(),
  progress: 100,
  url: '',
  base64Url: imageUrl,
  ...overrides,
})

export const remoteImage = (overrides: Partial<ImageFile> = {}): ImageFile => ({
  type: TransferMethod.remote_url,
  _id: 'remote-image',
  fileId: '',
  progress: 100,
  url: imageUrl,
  ...overrides,
})
