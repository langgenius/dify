import type { ImageFile, VisionSettings } from '@/types/app'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { Resolution, TransferMethod } from '@/types/app'
import TextGenerationImageUploader from '../text-generation-image-uploader'
import { brokenImageUrl, imageFile, imageUrl } from './image-fixtures'

vi.mock('@/next/navigation', () => ({ useParams: () => ({ token: 'shared-app' }) }))
const api = vi.hoisted(() => ({
  upload:
    vi.fn<
      (options: { data: FormData }, isPublic?: boolean, url?: string) => Promise<{ id: string }>
    >(),
}))
vi.mock('@/service/base', () => ({ upload: api.upload }))

const createSettings = (overrides: Partial<VisionSettings> = {}): VisionSettings => ({
  enabled: true,
  number_limits: 3,
  detail: Resolution.high,
  transfer_methods: [TransferMethod.local_file],
  image_file_size_limit: 10,
  ...overrides,
})

function UploadExample({
  settings = createSettings(),
  disabled = false,
}: {
  settings?: VisionSettings
  disabled?: boolean
}) {
  const [files, setFiles] = useState<ImageFile[]>([])
  return (
    <>
      <TextGenerationImageUploader
        settings={settings}
        disabled={disabled}
        onFilesChange={setFiles}
      />
      <output aria-label="Published images">
        {JSON.stringify(
          files.map(({ fileId, type, progress, url }) => ({ fileId, type, progress, url })),
        )}
      </output>
      <AppToaster timeout={0} />
    </>
  )
}

beforeEach(() => api.upload.mockResolvedValue({ id: 'uploaded-image' }))
afterEach(() => toast.dismiss())

it.each([
  [
    TransferMethod.local_file,
    'common.imageUploader.uploadFromComputer',
    'common.imageUploader.pasteImageLink',
  ],
  [
    TransferMethod.remote_url,
    'common.imageUploader.pasteImageLink',
    'common.imageUploader.uploadFromComputer',
  ],
])('offers only the configured method %s', async (method, visible, hidden) => {
  await page.viewport(800, 600)
  const screen = await render(
    <UploadExample settings={createSettings({ transfer_methods: [method] })} />,
  )
  await expect.element(screen.getByText(visible)).toBeVisible()
  await expect.element(screen.getByText(hidden)).not.toBeInTheDocument()
})

it('publishes actual local bytes as a completed, decoded preview', async () => {
  await page.viewport(800, 600)
  const screen = await render(<UploadExample />)
  await screen.getByLabelText('common.imageUploader.uploadFromComputer').upload(imageFile())
  await expect
    .element(screen.getByRole('status', { name: 'Published images' }))
    .toHaveTextContent(
      JSON.stringify([
        { fileId: 'uploaded-image', type: TransferMethod.local_file, progress: 100, url: imageUrl },
      ]),
    )
  await screen.getByRole('button', { name: /imageGallery.previewImage/ }).click()
  const image = page.getByRole('dialog').getByRole('presentation')
  await expect.element(image).toBeVisible()
  await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(1)
})

it('explains a numeric string size limit and leaves the published list empty', async () => {
  await page.viewport(800, 600)
  const screen = await render(
    <UploadExample settings={createSettings({ image_file_size_limit: '1' })} />,
  )
  await screen
    .getByLabelText('common.imageUploader.uploadFromComputer')
    .upload(new File([new Uint8Array(1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))
  await expect.element(page.getByText(/common.imageUploader.uploadFromComputerLimit/)).toBeVisible()
  await expect
    .element(screen.getByRole('status', { name: 'Published images' }))
    .toHaveTextContent('[]')
  expect(api.upload).not.toHaveBeenCalled()
})

it('publishes an invalid remote link, enforces the count limit and recovers after removal', async () => {
  await page.viewport(800, 600)
  const screen = await render(
    <UploadExample
      settings={createSettings({
        number_limits: 1,
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })}
    />,
  )
  const paste = screen.getByRole('button', { name: 'common.imageUploader.pasteImageLink' })
  await paste.click()
  const input = page.getByPlaceholder('common.imageUploader.pasteImageLinkInputPlaceholder')
  await input.fill(brokenImageUrl)
  await page.getByRole('button', { name: 'common.operation.ok' }).click()
  await expect.element(input).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('status', { name: 'Published images' }))
    .toHaveTextContent(
      JSON.stringify([
        { fileId: '', type: TransferMethod.remote_url, progress: -1, url: brokenImageUrl },
      ]),
    )
  await expect
    .element(screen.getByLabelText('common.imageUploader.uploadFromComputer'))
    .toBeDisabled()
  await expect.element(paste).toBeDisabled()
  await screen.getByRole('button', { name: 'common.operation.remove' }).click()
  await expect.element(screen.getByRole('listitem')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('status', { name: 'Published images' }))
    .toHaveTextContent('[]')
  await expect
    .element(screen.getByLabelText('common.imageUploader.uploadFromComputer'))
    .toBeEnabled()
  await expect.element(paste).toBeEnabled()
  // Removal also restores the real popover and its Escape focus handoff.
  await paste.click()
  await expect.element(input).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(input).not.toBeInTheDocument()
  await expect.element(paste).toHaveFocus()
})

it('disables both native upload entry points', async () => {
  await page.viewport(800, 600)
  const screen = await render(
    <UploadExample
      disabled
      settings={createSettings({
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })}
    />,
  )
  await expect
    .element(screen.getByLabelText('common.imageUploader.uploadFromComputer'))
    .toBeDisabled()
  await expect
    .element(screen.getByRole('button', { name: 'common.imageUploader.pasteImageLink' }))
    .toBeDisabled()
  await expect
    .element(page.getByPlaceholder('common.imageUploader.pasteImageLinkInputPlaceholder'))
    .not.toBeInTheDocument()
})
