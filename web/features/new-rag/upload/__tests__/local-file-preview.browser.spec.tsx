import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createPreviewPdf,
  guardPreviewFetch,
  hasPaintedPdfText,
} from '@/test/fixtures/preview-files'
import { LocalFilePreview } from '../local-file-preview'

function Preview({ file }: { file: File }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Preview file</button>
      <LocalFilePreview file={file} open={open} onOpenChange={setOpen} />
    </>
  )
}

beforeEach(() => onTestFinished(guardPreviewFetch()))

afterEach(() => vi.restoreAllMocks())

it('reads UTF-8 HTML as inert text and closes the real preview', async () => {
  await page.viewport(1024, 768)
  const file = new File(
    ['<script>document.title="EXECUTED"</script>\n让状态可分析'],
    '状态分析.html',
    { type: 'text/html' },
  )
  const title = document.title
  await render(<Preview file={file} />)
  await page.getByRole('button', { name: 'Preview file' }).click()
  const dialog = page.getByRole('dialog', { name: file.name })
  await expect
    .element(dialog.getByLabelText(file.name))
    .toHaveTextContent('<script>document.title="EXECUTED"</script> 让状态可分析')
  expect(document.title).toBe(title)
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Preview file' })).toHaveFocus()
})

it('renders a local PDF, releases its resource on Close and loads it again on reopen', async () => {
  await page.viewport(1024, 768)
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const create = vi.spyOn(URL, 'createObjectURL')
  await render(<Preview file={createPreviewPdf()} />)
  const trigger = page.getByRole('button', { name: 'Preview file' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'guide.pdf' })
  await expect.element(dialog.getByText('Dify local preview')).toBeVisible()
  await expect.poll(() => hasPaintedPdfText(dialog.element())).toBe(true)
  const resource = create.mock.results[0]!.value as string
  expect(revoke).not.toHaveBeenCalledWith(resource)
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(() => revoke.mock.calls.some(([url]) => url === resource)).toBe(true)
  await trigger.click()
  await expect.element(dialog.getByText('Dify local preview')).toBeVisible()
  expect(create.mock.results.some((result) => result.value !== resource)).toBe(true)
})
