import type { VisionSettings } from '@/types/app'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Resolution, TransferMethod } from '@/types/app'
import TextGenerationImageUploader from '../text-generation-image-uploader'
import { imageUpload } from '../utils'

vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils')>()),
  imageUpload: vi.fn(),
}))
const upload = vi.mocked(imageUpload)
beforeEach(() => vi.resetAllMocks())

const createSettings = (overrides: Partial<VisionSettings> = {}): VisionSettings => ({
  enabled: true,
  number_limits: 3,
  detail: Resolution.high,
  transfer_methods: [TransferMethod.local_file],
  image_file_size_limit: 10,
  ...overrides,
})

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
])('offers the configured upload method %s', (method, visible, hidden) => {
  render(
    <TextGenerationImageUploader
      settings={createSettings({ transfer_methods: [method] })}
      onFilesChange={vi.fn()}
    />,
  )
  expect(screen.getByText(visible)).toBeInTheDocument()
  expect(screen.queryByText(hidden)).not.toBeInTheDocument()
})

it('uploads through the real local hook and publishes completed files', async () => {
  const user = userEvent.setup()
  const onFilesChange = vi.fn()
  render(<TextGenerationImageUploader settings={createSettings()} onFilesChange={onFilesChange} />)
  const file = new File(['image'], 'sample.png', { type: 'image/png' })
  await user.upload(screen.getByTestId('local-file-input'), file)
  await waitFor(() => expect(upload).toHaveBeenCalledOnce())
  expect(upload.mock.calls[0]![0].file).toBe(file)
  act(() => upload.mock.calls[0]![0].onSuccessCallback({ id: 'uploaded-image' }))
  await waitFor(() =>
    expect(onFilesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        file,
        fileId: 'uploaded-image',
        type: TransferMethod.local_file,
        progress: 100,
      }),
    ]),
  )
})

it('rejects images above a numeric string size limit without uploading', async () => {
  const user = userEvent.setup()
  const onFilesChange = vi.fn()
  render(
    <TextGenerationImageUploader
      settings={createSettings({ image_file_size_limit: '1' })}
      onFilesChange={onFilesChange}
    />,
  )
  const file = new File([new Uint8Array(1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
  await user.upload(screen.getByTestId('local-file-input'), file)
  expect(upload).not.toHaveBeenCalled()
  expect(onFilesChange).toHaveBeenLastCalledWith([])
})

it('publishes remote image load state, enforces the limit, and re-enables uploads after removal', async () => {
  const user = userEvent.setup()
  const onFilesChange = vi.fn()
  render(
    <TextGenerationImageUploader
      settings={createSettings({
        number_limits: 1,
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })}
      onFilesChange={onFilesChange}
    />,
  )
  await user.click(screen.getByText('common.imageUploader.pasteImageLink'))
  await user.type(
    await screen.findByPlaceholderText('common.imageUploader.pasteImageLinkInputPlaceholder'),
    'https://example.com/image.png',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
  await waitFor(() =>
    expect(onFilesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        type: TransferMethod.remote_url,
        url: 'https://example.com/image.png',
        progress: 0,
      }),
    ]),
  )
  expect(screen.getByTestId('local-file-input')).toBeDisabled()
  await user.click(screen.getByText('common.imageUploader.pasteImageLink'))
  expect(
    screen.queryByPlaceholderText('common.imageUploader.pasteImageLinkInputPlaceholder'),
  ).not.toBeInTheDocument()
  // Native image load/error events are supplied by the browser, not user input.
  const image = screen.getByRole('presentation')
  fireEvent.error(image)
  expect(onFilesChange).toHaveBeenLastCalledWith([expect.objectContaining({ progress: -1 })])
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(onFilesChange).toHaveBeenLastCalledWith([])
  expect(screen.getByTestId('local-file-input')).toBeEnabled()
})

it('blocks both upload entry points when disabled', async () => {
  const user = userEvent.setup()
  render(
    <TextGenerationImageUploader
      disabled
      settings={createSettings({
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })}
      onFilesChange={vi.fn()}
    />,
  )
  expect(screen.getByTestId('local-file-input')).toBeDisabled()
  await user.click(screen.getByText('common.imageUploader.pasteImageLink'))
  expect(
    screen.queryByPlaceholderText('common.imageUploader.pasteImageLinkInputPlaceholder'),
  ).not.toBeInTheDocument()
})
