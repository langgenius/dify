import type { ConsoleClient } from '@/service/console'
import { ORPCError } from '@orpc/client'
import { waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { getImageUploadErrorMessage, imageUpload } from '../utils'

const upload = vi.hoisted(() =>
  vi.fn<typeof import('@/service/webapp-client').webAppClient.files.upload.post>(),
)
vi.mock('@/service/webapp-client', () => ({
  webAppClient: { files: { upload: { post: upload } } },
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
  upload.mockReset().mockResolvedValue({ id: 'uploaded-id', name: 'image.png', size: 5 })
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

it('uploads public web app images through the WebApp files contract', async () => {
  const selected = file()
  const events = callbacks()
  imageUpload({ file: selected, ...events }, true)
  await waitFor(() =>
    expect(events.onSuccessCallback).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'uploaded-id' }),
    ),
  )
  expect(upload).toHaveBeenCalledExactlyOnceWith(
    { body: { file: selected } },
    { context: { silent: true, onUploadProgress: expect.any(Function) } },
  )
  expect(consoleUpload).not.toHaveBeenCalled()
})

it('forwards a failed upload without reporting success', async () => {
  const error = new Error('Upload failed')
  consoleUpload.mockRejectedValue(error)
  const events = callbacks()
  imageUpload({ file: file(), ...events })
  await waitFor(() => expect(events.onErrorCallback).toHaveBeenCalledExactlyOnceWith(error))
  expect(events.onSuccessCallback).not.toHaveBeenCalled()
})
