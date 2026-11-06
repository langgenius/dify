import type { FileEntity } from '../types'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TransferMethod } from '@/types/app'
import FileListInLog from '../file-list-in-log'

const imageDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='

const createFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'test.txt',
  size: 1024,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  ...overrides,
})

it('reveals mixed log attachments with native hover and keyboard disclosure, then removes the empty disclosure', async () => {
  const fileList = [
    {
      varName: 'images',
      list: [
        createFile({
          id: 'photo',
          name: 'photo.png',
          supportFileType: 'image',
          url: imageDataUrl,
        }),
      ],
    },
    { varName: 'documents', list: [createFile({ id: 'report', name: 'report.txt' })] },
  ]
  const view = await render(
    <div>
      <button type="button">Before attachments</button>
      <FileListInLog fileList={fileList} />
    </div>,
  )

  const preview = page.getByRole('img', { name: 'Preview' })
  await expect.element(preview).toHaveAttribute('src', imageDataUrl)
  await preview.hover()
  await expect.element(page.getByText('photo.png')).toBeVisible()
  await expect.element(page.getByText('documents')).not.toBeInTheDocument()

  await page.getByRole('button', { name: 'Before attachments' }).click()
  await userEvent.tab()
  const disclosure = page.getByRole('button', { name: 'appLog.runDetail.fileListDetail' })
  await expect.element(disclosure).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('images')).toBeVisible()
  await expect.element(page.getByText('documents')).toBeVisible()
  await expect.element(page.getByText('photo.png')).toBeVisible()
  await expect.element(page.getByText('report.txt')).toBeVisible()

  await userEvent.tab({ shift: true })
  const collapse = page.getByRole('button', { name: 'appLog.runDetail.fileListLabel' })
  await expect.element(collapse).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('documents')).not.toBeInTheDocument()
  await expect.element(disclosure).toBeVisible()

  await view.rerender(
    <div>
      <button type="button">Before attachments</button>
      <FileListInLog fileList={[]} />
    </div>,
  )
  await expect.element(disclosure).not.toBeInTheDocument()
})
