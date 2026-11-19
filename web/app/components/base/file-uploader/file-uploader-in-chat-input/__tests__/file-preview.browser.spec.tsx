import type { FileEntity } from '../../types'
import { render } from 'vitest-browser-react'
import { TransferMethod } from '@/types/app'
import { FileItem } from '../file-item'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('retains the local media resource during the real exit transition and releases it afterwards', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const createUrl = vi.spyOn(URL, 'createObjectURL')
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL')
  const file: FileEntity = {
    id: 'file-1',
    name: 'recording.wav',
    size: 2048,
    type: 'audio/wav',
    progress: 100,
    transferMethod: TransferMethod.local_file,
    supportFileType: 'document',
    uploadedId: 'uploaded-1',
    originalFile: new File(['recording'], 'recording.wav', { type: 'audio/wav' }),
  }
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
})
