import type { FileEntity } from '../../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { TransferMethod } from '@/types/app'
import { FileContextProvider } from '../../store'
import { FileListInChatInput } from '../file-list'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/' }))

it('removes mixed chat attachments through their real keyboard and pointer affordances', async () => {
  const files: FileEntity[] = [
    {
      id: 'photo',
      name: 'photo.png',
      type: 'image/png',
      size: 1024,
      progress: 100,
      transferMethod: TransferMethod.local_file,
      supportFileType: 'image',
      base64Url:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    },
    {
      id: 'document',
      name: 'document.pdf',
      type: 'application/pdf',
      size: 2048,
      progress: 100,
      transferMethod: TransferMethod.local_file,
      supportFileType: 'document',
    },
  ]
  const config: FileUpload = { enabled: true, allowed_file_types: ['image', 'document'] }
  const onChange = vi.fn()
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  await render(
    <ConsoleProvider>
      <button type="button">Before attachments</button>
      <FileContextProvider value={files} onChange={onChange}>
        <FileListInChatInput fileConfig={config} />
      </FileContextProvider>
    </ConsoleProvider>,
  )

  await expect.element(page.getByRole('img', { name: 'Preview' })).toBeVisible()
  await expect.element(page.getByText('document.pdf')).toBeVisible()
  await page.getByRole('button', { name: 'Before attachments' }).click()
  await userEvent.tab()
  await expect
    .element(page.getByRole('button', { name: 'common.operation.view photo.png' }))
    .toHaveFocus()
  await userEvent.tab()
  const imageRemove = page.getByRole('button', { name: 'common.operation.remove' }).first()
  await expect.element(imageRemove).toHaveFocus()
  await expect.poll(() => getComputedStyle(imageRemove.element()).opacity).toBe('1')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('img', { name: 'Preview' })).not.toBeInTheDocument()
  await expect.element(page.getByText('document.pdf')).toBeVisible()
  expect(onChange).toHaveBeenLastCalledWith([files[1]])

  await page.getByText('document.pdf').hover()
  const documentRemove = page.getByRole('button', { name: 'common.operation.remove' })
  await expect.element(documentRemove).toBeVisible()
  await documentRemove.click()
  await expect.element(page.getByText('document.pdf')).not.toBeInTheDocument()
  expect(onChange).toHaveBeenLastCalledWith([])
})
