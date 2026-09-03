import type { FileEntity } from '../../types'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import FileImageItem from '../file-image-item'

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

const file: FileEntity = {
  id: 'file-1',
  name: 'photo.png',
  size: 4096,
  type: 'image/png',
  progress: 100,
  transferMethod: 'local_file',
  supportFileType: 'image',
  uploadedId: 'uploaded-1',
  base64Url: 'data:image/png;base64,abc',
  url: 'https://example.com/photo.png',
}

describe('FileImageItem pointer interaction', () => {
  it('keeps the preview clickable when the download action is visible', async () => {
    const screen = await render(<FileImageItem file={file} canPreview showDownloadAction />)
    const preview = screen.getByRole('button', { name: 'common.operation.view photo.png' })
    const download = screen.getByRole('button', { name: 'common.operation.download' })

    await preview.hover()
    await expect.element(download).toBeVisible()
    await preview.click()

    await expect.element(page.getByRole('dialog')).toBeVisible()
  })
})
