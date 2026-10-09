import type { ReactNode } from 'react'
import type { FileEntity } from '../../types'
import { useEffect, useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TransferMethod } from '@/types/app'
import { FileItem } from '../file-item'

const pdfEngine = vi.hoisted(() => ({ ready: Promise.resolve() }))

// Keep the preview, zoom controls and lazy boundary real; replace only PDF decoding.
vi.mock('../../pdf-highlighter-adapter', () => ({
  PdfLoader: ({
    children,
    beforeLoad,
  }: {
    children: (document: object) => ReactNode
    beforeLoad: ReactNode
  }) => {
    const [loaded, setLoaded] = useState(false)
    useEffect(() => {
      let active = true
      void pdfEngine.ready.then(() => {
        if (active) setLoaded(true)
      })
      return () => {
        active = false
      }
    }, [])
    return loaded ? children({}) : beforeLoad
  },
  PdfHighlighter: () => (
    <div role="document" aria-label="PDF page" style={{ width: 200, height: 300 }}>
      A PDF page
    </div>
  ),
}))

function createFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    id: 'file-1',
    name: 'document.pdf',
    size: 2048,
    type: 'application/pdf',
    progress: 100,
    transferMethod: TransferMethod.local_file,
    supportFileType: 'document',
    uploadedId: 'uploaded-1',
    url: 'https://example.com/document.pdf',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('keeps Close focused through PDF loading, handles zoom keys there and starts a fresh preview', async () => {
  let resolvePdf!: () => void
  pdfEngine.ready = new Promise<void>((resolve) => {
    resolvePdf = resolve
  })
  const screen = await render(<FileItem file={createFile()} canPreview />)
  const filename = screen.getByRole('button', { name: 'document.pdf' })
  await userEvent.tab()
  await expect.element(filename).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: 'document.pdf' })
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  await expect.element(close).toHaveFocus()
  const initialClose = close.element()
  const page = dialog.getByRole('document', { name: 'PDF page' })
  await expect.element(page).not.toBeInTheDocument()

  resolvePdf()
  await expect.element(page).toBeVisible()
  expect(close.element()).toBe(initialClose)
  await expect.element(close).toHaveFocus()
  await expect.poll(() => Math.round(page.element().getBoundingClientRect().width)).toBe(200)
  await userEvent.keyboard('{ArrowUp}')
  await expect.poll(() => Math.round(page.element().getBoundingClientRect().width)).toBe(240)
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(() => Math.round(page.element().getBoundingClientRect().width)).toBe(200)
  await userEvent.keyboard('{ArrowUp}{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(filename).toHaveFocus()

  await userEvent.keyboard(' ')
  await expect.element(close).toHaveFocus()
  await expect.element(page).toBeVisible()
  await expect.poll(() => Math.round(page.element().getBoundingClientRect().width)).toBe(200)
  await close.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(filename).toHaveFocus()
})

it('retains the local media resource during the real exit transition and releases it afterwards', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const createUrl = vi.spyOn(URL, 'createObjectURL')
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL')
  const file = createFile({
    name: 'recording.wav',
    type: 'audio/wav',
    url: undefined,
    originalFile: new File(['recording'], 'recording.wav', { type: 'audio/wav' }),
  })
  const screen = await render(<FileItem file={file} canPreview />)
  const filename = screen.getByRole('button', { name: 'recording.wav' })
  expect(createUrl).not.toHaveBeenCalled()
  await filename.click()
  const dialog = screen.getByRole('dialog', { name: 'recording.wav' })
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  await expect.element(close).toHaveFocus()
  await expect.poll(() => createUrl.mock.results.length).toBe(1)
  const resource = createUrl.mock.results[0]!.value as string
  const popup = dialog.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exitFrame = new Promise<{ opacity: number; revoked: boolean }>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      resolve({
        opacity: Number(getComputedStyle(popup).opacity),
        revoked: revokeUrl.mock.calls.some(([url]) => url === resource),
      })
    }
    popup.addEventListener('transitionrun', onTransition)
  })
  await close.click()
  const closing = await exitFrame
  expect(closing.opacity).toBeGreaterThan(0)
  expect(closing.revoked).toBe(false)
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(() => revokeUrl.mock.calls.some(([url]) => url === resource)).toBe(true)
  await expect.element(filename).toHaveFocus()
})
