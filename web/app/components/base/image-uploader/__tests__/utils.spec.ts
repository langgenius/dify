import { ORPCError } from '@orpc/client'
import { waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { getImageUploadErrorMessage, imageUpload } from '../utils'

const upload = vi.hoisted(() => vi.fn<typeof import('@/service/base').upload>())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  upload,
}))
const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    resources: {
      en: { common: { fileUploader: { fileExtensionBlocked: 'This file type is blocked.' } } },
    },
  })
})
beforeEach(() => {
  upload.mockReset().mockResolvedValue({ id: 'uploaded-id' })
})

it.each([
  {
    error: new ORPCError('forbidden', { message: 'Forbidden by policy' }),
    expected: 'Forbidden by policy',
  },
  { error: new ORPCError('file_extension_blocked'), expected: 'This file type is blocked.' },
  { error: new ORPCError('unexpected_error'), expected: 'Upload failed' },
  { error: new Error('Network unavailable'), expected: 'Upload failed' },
])('returns the user-facing error for $error.code / $error.message', ({ error, expected }) => {
  expect(getImageUploadErrorMessage(error, 'Upload failed', i18n.getFixedT('en', ['common']))).toBe(
    expected,
  )
})

const file = () => new File(['image'], 'image.png', { type: 'image/png' })
const callbacks = () => ({
  onProgressCallback: vi.fn<(progress: number) => void>(),
  onSuccessCallback: vi.fn<(res: { id: string }) => void>(),
  onErrorCallback: vi.fn<(error?: unknown) => void>(),
})

it('passes the file and upload destination to the service and reports the server result', async () => {
  const selected = file()
  const events = callbacks()
  imageUpload({ file: selected, ...events }, true, '/files/upload')
  expect(upload).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ data: expect.any(FormData) }),
    true,
    '/files/upload',
  )
  expect(upload.mock.calls[0]![0].data.get('file')).toBe(selected)
  await waitFor(() =>
    expect(events.onSuccessCallback).toHaveBeenCalledExactlyOnceWith({ id: 'uploaded-id' }),
  )
  expect(events.onErrorCallback).not.toHaveBeenCalled()
})

it('forwards a failed upload without reporting success', async () => {
  const error = new Error('Upload failed')
  upload.mockRejectedValue(error)
  const events = callbacks()
  imageUpload({ file: file(), ...events })
  await waitFor(() => expect(events.onErrorCallback).toHaveBeenCalledExactlyOnceWith(error))
  expect(events.onSuccessCallback).not.toHaveBeenCalled()
})

it.each([true, false])(
  'only reports a progress percentage when the total is known (%s)',
  async (lengthComputable) => {
    upload.mockImplementation(async (options) => {
      options.onprogress?.call(
        options.xhr,
        new ProgressEvent('progress', { lengthComputable, loaded: 5, total: 8 }),
      )
      return { id: 'uploaded-id' }
    })
    const events = callbacks()
    imageUpload({ file: file(), ...events })
    if (lengthComputable) expect(events.onProgressCallback).toHaveBeenCalledExactlyOnceWith(62)
    else expect(events.onProgressCallback).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(events.onSuccessCallback).toHaveBeenCalledExactlyOnceWith({ id: 'uploaded-id' }),
    )
  },
)
