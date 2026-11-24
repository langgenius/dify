import type { ConsoleClient } from '@/service/console'
import { ORPCError } from '@orpc/client'
import { waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { getImageUploadErrorMessage, imageUpload } from '../utils'

const upload = vi.hoisted(() => vi.fn<typeof import('@/service/base').upload>())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  upload,
}))
const consoleUpload = vi.hoisted(() => vi.fn<ConsoleClient['files']['upload']['post']>())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'files.upload.post': consoleUpload,
    }),
  }
})
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
  consoleUpload.mockReset().mockResolvedValue({ id: 'uploaded-id', name: 'image.png', size: 5 })
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

it('uploads console images through the files contract and reports the server result', async () => {
  const selected = file()
  const events = callbacks()
  imageUpload({ file: selected, ...events })
  expect(consoleUpload).toHaveBeenCalledExactlyOnceWith(
    { body: { file: selected } },
    { context: { silent: true, onUploadProgress: expect.any(Function) } },
  )
  expect(upload).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(events.onSuccessCallback).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'uploaded-id' }),
    ),
  )
  expect(events.onErrorCallback).not.toHaveBeenCalled()
})

it('reports console upload progress as a percentage', () => {
  const events = callbacks()
  imageUpload({ file: file(), ...events })
  consoleUpload.mock.calls[0]![1]!.context!.onUploadProgress!({ loaded: 5, total: 8 })
  expect(events.onProgressCallback).toHaveBeenCalledExactlyOnceWith(62)
})

it('uploads public web app images through the public upload transport', async () => {
  const selected = file()
  const events = callbacks()
  imageUpload({ file: selected, ...events }, true)
  expect(upload).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ data: expect.any(FormData) }),
    true,
  )
  expect(upload.mock.calls[0]![0].data.get('file')).toBe(selected)
  expect(consoleUpload).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(events.onSuccessCallback).toHaveBeenCalledExactlyOnceWith({ id: 'uploaded-id' }),
  )
})

it('forwards a failed upload without reporting success', async () => {
  const error = new Error('Upload failed')
  consoleUpload.mockRejectedValue(error)
  const events = callbacks()
  imageUpload({ file: file(), ...events })
  await waitFor(() => expect(events.onErrorCallback).toHaveBeenCalledExactlyOnceWith(error))
  expect(events.onSuccessCallback).not.toHaveBeenCalled()
})

it.each([true, false])(
  'only reports a public upload progress percentage when the total is known (%s)',
  async (lengthComputable) => {
    upload.mockImplementation(async (options) => {
      options.onprogress?.call(
        options.xhr,
        new ProgressEvent('progress', { lengthComputable, loaded: 5, total: 8 }),
      )
      return { id: 'uploaded-id' }
    })
    const events = callbacks()
    imageUpload({ file: file(), ...events }, true)
    if (lengthComputable) expect(events.onProgressCallback).toHaveBeenCalledExactlyOnceWith(62)
    else expect(events.onProgressCallback).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(events.onSuccessCallback).toHaveBeenCalledExactlyOnceWith({ id: 'uploaded-id' }),
    )
  },
)
