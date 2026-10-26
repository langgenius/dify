import type { ReactNode } from 'react'
import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { ORPCError } from '@orpc/client'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { toast } from '@/app/notifications'
import { captureAppAccessScope, handleAppAccessError } from '@/features/app-access-error/state'
import { uploadPublicRemoteFileInfo } from '@/service/common'
import { uploadHumanInputFormLocalFile, uploadHumanInputFormRemoteFileInfo } from '@/service/share'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { getFileSizeLimit, useFile } from '../hooks'
import { createFileStore, FileContext, useStore } from '../store'
import { FileUploadContext } from '../upload-context'
import { fileUpload } from '../utils'

const request = vi.hoisted(() => vi.fn<typeof import('@/service/base').request>())
vi.mock('@/service/base', () => ({ request }))

const navigation = vi.hoisted(() => ({ params: {} as { token?: string }, pathname: '/chat' }))
vi.mock('@/next/navigation', () => ({
  useParams: () => navigation.params,
  usePathname: () => navigation.pathname,
}))
vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils')>()),
  fileUpload: vi.fn(),
}))
vi.mock('@/service/common', () => ({ uploadPublicRemoteFileInfo: vi.fn() }))
vi.mock('@/service/share', () => ({
  uploadHumanInputFormLocalFile: vi.fn(),
  uploadHumanInputFormRemoteFileInfo: vi.fn(),
}))

const config: FileUpload = {
  enabled: true,
  allowed_file_types: ['image', 'document', 'audio', 'video'],
  allowed_file_extensions: [],
  allowed_file_upload_methods: ['local_file', 'remote_url'],
  number_limits: 5,
}
const uploadResponse = {
  id: 'uploaded-file',
  name: 'report.pdf',
  mime_type: 'application/pdf',
  size: 100,
  created_at: 0,
  created_by: 'user-1',
  extension: 'pdf',
  preview_url: null,
  source_url: '',
  url: 'https://example.com/report.pdf',
}
const entity = (id: string): FileEntity => ({
  id,
  name: `${id}.txt`,
  type: 'text/plain',
  size: 1,
  progress: 0,
  transferMethod: 'local_file',
  supportFileType: 'document',
  originalFile: new File(['text'], `${id}.txt`, { type: 'text/plain' }),
})
function setup({
  files = [],
  fileConfig = config,
  uploadUrls = {},
  checkEnabled = false,
}: {
  files?: FileEntity[]
  fileConfig?: FileUpload
  uploadUrls?: { localUploadUrl?: string; trialAppId?: string }
  checkEnabled?: boolean
} = {}) {
  const onChange = vi.fn()
  const store = createFileStore(files, onChange)
  const { wrapper: ConsoleWrapper } = createConsoleQueryWrapper()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      ConsoleWrapper,
      null,
      createElement(
        FileContext,
        { value: store },
        createElement(FileUploadContext, { value: uploadUrls }, children),
      ),
    )
  return {
    ...renderHook(
      () => ({ ...useFile(fileConfig, !checkEnabled), files: useStore((state) => state.files) }),
      { wrapper },
    ),
    store,
    onChange,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  request.mockReset().mockImplementation(async () => Response.json(uploadResponse))
  window.history.replaceState({}, '', '/')
  captureAppAccessScope()
  navigation.params = {}
  navigation.pathname = '/chat'
  vi.spyOn(toast, 'error').mockReturnValue('toast-id')
  vi.mocked(uploadPublicRemoteFileInfo).mockResolvedValue(uploadResponse)
  vi.mocked(uploadHumanInputFormRemoteFileInfo).mockResolvedValue(uploadResponse)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('getFileSizeLimit', () => {
  it('should return default limits when no config is provided', () => {
    const result = getFileSizeLimit()

    expect(result.imgSizeLimit).toBe(10 * 1024 * 1024)
    expect(result.docSizeLimit).toBe(15 * 1024 * 1024)
    expect(result.audioSizeLimit).toBe(50 * 1024 * 1024)
    expect(result.videoSizeLimit).toBe(100 * 1024 * 1024)
    expect(result.skillSizeLimit).toBe(50 * 1024 * 1024)
    expect(result.maxFileUploadLimit).toBe(10)
  })

  it('should use config values when provided', () => {
    const config = createFileUploadConfigFixture({
      image_file_size_limit: 20,
      file_size_limit: 30,
      audio_file_size_limit: 100,
      video_file_size_limit: 200,
      skill_file_size_limit: 60,
      workflow_file_upload_limit: 20,
    })

    const result = getFileSizeLimit(config)

    expect(result.imgSizeLimit).toBe(20 * 1024 * 1024)
    expect(result.docSizeLimit).toBe(30 * 1024 * 1024)
    expect(result.audioSizeLimit).toBe(100 * 1024 * 1024)
    expect(result.videoSizeLimit).toBe(200 * 1024 * 1024)
    expect(result.skillSizeLimit).toBe(60 * 1024 * 1024)
    expect(result.maxFileUploadLimit).toBe(20)
  })

  it('should fall back to defaults when config values are zero', () => {
    const config = createFileUploadConfigFixture({
      image_file_size_limit: 0,
      file_size_limit: 0,
      audio_file_size_limit: 0,
      video_file_size_limit: 0,
      skill_file_size_limit: 0,
      workflow_file_upload_limit: 0,
    })

    const result = getFileSizeLimit(config)

    expect(result.imgSizeLimit).toBe(10 * 1024 * 1024)
    expect(result.docSizeLimit).toBe(15 * 1024 * 1024)
    expect(result.audioSizeLimit).toBe(50 * 1024 * 1024)
    expect(result.videoSizeLimit).toBe(100 * 1024 * 1024)
    expect(result.skillSizeLimit).toBe(50 * 1024 * 1024)
    expect(result.maxFileUploadLimit).toBe(10)
  })
})

it('writes consecutive file edits to the real store and notifies subscribers', () => {
  const { result, onChange } = setup()
  act(() => result.current.handleAddFile(entity('one')))
  act(() => result.current.handleAddFile(entity('two')))
  act(() => result.current.handleUpdateFile({ ...entity('one'), progress: 50 }))
  expect(result.current.files.map(({ id, progress }) => ({ id, progress }))).toEqual([
    { id: 'one', progress: 50 },
    { id: 'two', progress: 0 },
  ])
  act(() => result.current.handleUpdateFile(entity('missing')))
  expect(result.current.files).toHaveLength(2)
  act(() => result.current.handleRemoveFile('one'))
  expect(result.current.files.map((file) => file.id)).toEqual(['two'])
  act(() => result.current.handleClearFiles())
  expect(result.current.files).toEqual([])
  expect(onChange).toHaveBeenLastCalledWith([])
})

it('keeps concurrent local uploads separate while progress, failure and retry update the store', async () => {
  const { result } = setup()
  act(() => {
    result.current.handleLocalFileUpload(new File(['a'], 'one.txt', { type: 'text/plain' }))
    result.current.handleLocalFileUpload(new File(['b'], 'two.txt', { type: 'text/plain' }))
  })
  await waitFor(() => expect(fileUpload).toHaveBeenCalledTimes(2))
  const first = vi.mocked(fileUpload).mock.calls[0]![0]
  const second = vi.mocked(fileUpload).mock.calls[1]![0]
  const firstId = result.current.files.find((file) => file.name === first.file.name)!.id
  act(() => {
    first.onProgressCallback(40)
    second.onSuccessCallback({ ...uploadResponse, id: 'second' })
  })
  expect(result.current.files.find((file) => file.id === firstId)?.progress).toBe(40)
  expect(result.current.files.find((file) => file.name === second.file.name)?.uploadedId).toBe(
    'second',
  )
  act(() => first.onErrorCallback(new ORPCError('file_extension_blocked')))
  expect(result.current.files.find((file) => file.id === firstId)?.progress).toBe(-1)
  expect(toast.error).toHaveBeenCalledWith('common.fileUploader.fileExtensionBlocked')
  act(() => result.current.handleReUploadFile(firstId))
  expect(result.current.files.find((file) => file.id === firstId)?.progress).toBe(0)
  act(() => vi.mocked(fileUpload).mock.calls[2]![0].onSuccessCallback(uploadResponse))
  expect(result.current.files).toHaveLength(2)
  expect(result.current.files.every((file) => file.progress === 100)).toBe(true)
})

it.each([
  ['photo.png', 'image/png', 'image', 'image_file_size_limit'],
  ['report.pdf', 'application/pdf', 'document', 'file_size_limit'],
  ['voice.mp3', 'audio/mpeg', 'audio', 'audio_file_size_limit'],
  ['movie.mp4', 'video/mp4', 'video', 'video_file_size_limit'],
] as const)(
  'applies the actual %s type and its configured size limit',
  async (name, type, expectedType, sizeKey) => {
    const { result } = setup({
      fileConfig: { ...config, fileUploadConfig: createFileUploadConfigFixture({ [sizeKey]: 1 }) },
    })
    const oversized = new File(['a'], name, { type })
    Object.defineProperty(oversized, 'size', { value: 2 * 1024 * 1024 })
    act(() => result.current.handleLocalFileUpload(oversized))
    expect(fileUpload).not.toHaveBeenCalled()
    expect(result.current.files).toEqual([])
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('common.fileUploader.uploadFromComputerLimit'),
    )
    act(() => result.current.handleLocalFileUpload(new File(['a'], name, { type })))
    await waitFor(() => expect(fileUpload).toHaveBeenCalledTimes(1))
    expect(result.current.files[0]).toEqual(
      expect.objectContaining({ name, supportFileType: expectedType, progress: 0 }),
    )
    expect(result.current.files[0]?.base64Url).toBe(
      expectedType === 'image' ? 'data:image/png;base64,YQ==' : '',
    )
  },
)

it('rejects unsupported extensions and accepts explicitly allowed custom files', async () => {
  const file = new File(['data'], 'payload.xyz', { type: '' })
  const rejected = setup()
  act(() => rejected.result.current.handleLocalFileUpload(file))
  expect(rejected.result.current.files).toEqual([])
  expect(fileUpload).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('fileExtensionNotSupport'))
  const accepted = setup({
    fileConfig: { ...config, allowed_file_types: ['custom'], allowed_file_extensions: ['.xyz'] },
  })
  act(() => accepted.result.current.handleLocalFileUpload(file))
  await waitFor(() => expect(fileUpload).toHaveBeenCalledTimes(1))
  expect(accepted.result.current.files[0]?.supportFileType).toBe('custom')
})

it('respects disabled uploads when the caller enables the check', () => {
  const { result } = setup({ fileConfig: { ...config, enabled: false }, checkEnabled: true })
  act(() =>
    result.current.handleLocalFileUpload(new File(['data'], 'a.txt', { type: 'text/plain' })),
  )
  expect(fileUpload).not.toHaveBeenCalled()
  expect(result.current.files).toEqual([])
  expect(toast.error).toHaveBeenCalledWith('common.fileUploader.uploadDisabled')
})

it('uses resource-specific local and remote upload endpoints', async () => {
  const { result } = setup({
    uploadUrls: { localUploadUrl: '/trial-apps/trial-1/files/upload', trialAppId: 'trial-1' },
  })
  act(() =>
    result.current.handleLocalFileUpload(new File(['data'], 'a.txt', { type: 'text/plain' })),
  )
  await waitFor(() =>
    expect(fileUpload).toHaveBeenCalledWith(
      expect.any(Object),
      false,
      '/trial-apps/trial-1/files/upload',
    ),
  )
  await act(async () => result.current.handleLoadFileFromLink('https://example.com/report.pdf'))
  await waitFor(() => expect(request).toHaveBeenCalled())
  expect(new URL(request.mock.calls[0]![0]).pathname).toBe(
    '/console/api/trial-apps/trial-1/remote-files/upload',
  )
  expect(await request.mock.calls[0]?.[2]?.request?.json()).toEqual({
    url: 'https://example.com/report.pdf',
  })
  await waitFor(() =>
    expect(result.current.files.find((file) => file.isRemote)?.uploadedId).toBe('uploaded-file'),
  )
  expect(result.current.files.find((file) => file.isRemote)?.uploadedId).toBe('uploaded-file')
})

it('routes human-input form uploads and retries through the form token', async () => {
  navigation.params = { token: 'form-token' }
  navigation.pathname = '/form/form-token'
  const { result } = setup({ files: [entity('retry')] })
  act(() => result.current.handleReUploadFile('retry'))
  expect(uploadHumanInputFormLocalFile).toHaveBeenCalledWith(
    expect.objectContaining({ formToken: 'form-token', file: expect.any(File) }),
  )
  act(() =>
    result.current.handleLocalFileUpload(new File(['data'], 'a.txt', { type: 'text/plain' })),
  )
  await waitFor(() => expect(uploadHumanInputFormLocalFile).toHaveBeenCalledTimes(2))
  await act(async () => result.current.handleLoadFileFromLink('https://example.com/report.pdf'))
  expect(uploadHumanInputFormRemoteFileInfo).toHaveBeenCalledWith(
    'form-token',
    'https://example.com/report.pdf',
  )
  expect(fileUpload).not.toHaveBeenCalled()
  expect(uploadPublicRemoteFileInfo).not.toHaveBeenCalled()
})

it('keeps public chat tokens on the normal upload transport', async () => {
  navigation.params = { token: 'chat-token' }
  navigation.pathname = '/chat/chat-token'
  const { result } = setup()
  act(() =>
    result.current.handleLocalFileUpload(new File(['data'], 'a.txt', { type: 'text/plain' })),
  )
  await waitFor(() => expect(fileUpload).toHaveBeenCalledWith(expect.any(Object), true, undefined))
  await act(async () => result.current.handleLoadFileFromLink('https://example.com/report.pdf'))
  expect(uploadPublicRemoteFileInfo).toHaveBeenCalledWith('https://example.com/report.pdf')
  expect(uploadHumanInputFormLocalFile).not.toHaveBeenCalled()
})

it.each(['unsupported', 'oversized', 'failed'] as const)(
  'removes a remote file when it is %s',
  async (condition) => {
    if (condition === 'failed') request.mockRejectedValueOnce(new Error('offline'))
    else
      request.mockResolvedValueOnce(
        Response.json({
          ...uploadResponse,
          ...(condition === 'unsupported'
            ? { name: 'file.xyz', mime_type: 'application/octet-stream' }
            : { size: 100 * 1024 * 1024 }),
        }),
      )
    const { result } = setup()
    await act(async () => result.current.handleLoadFileFromLink('https://example.com/file'))
    await waitFor(() => expect(result.current.files).toEqual([]))
    expect(toast.error).toHaveBeenCalled()
  },
)

it('advances pending remote progress only to 80 percent and completes from the response', async () => {
  vi.useFakeTimers()
  const pending = createDeferred<Response>()
  request.mockReturnValueOnce(pending.promise)
  const { result } = setup()
  act(() => result.current.handleLoadFileFromLink('https://example.com/report.pdf'))
  act(() => vi.advanceTimersByTime(2000))
  expect(result.current.files[0]?.progress).toBe(80)
  await act(async () => pending.resolve(Response.json(uploadResponse)))
  expect(result.current.files[0]).toEqual(
    expect.objectContaining({
      progress: 100,
      uploadedId: 'uploaded-file',
      supportFileType: 'document',
    }),
  )
})

it.each(['local', 'retry', 'remote'] as const)(
  'settles a denied or cancelled %s upload without duplicate error feedback',
  async (uploadKind) => {
    for (const cancelled of [false, true]) {
      const error = cancelled
        ? new DOMException('Upload cancelled', 'AbortError')
        : new ORPCError('ip_access_denied', { status: 403 })
      if (!cancelled) {
        window.history.replaceState({}, '', '/chat/restricted-app')
        handleAppAccessError(403, { code: 'ip_access_denied' }, captureAppAccessScope(), error)
      }
      const { result, unmount } = setup({ files: uploadKind === 'retry' ? [entity('retry')] : [] })
      if (uploadKind === 'remote') {
        request.mockRejectedValueOnce(error)
        await act(async () => result.current.handleLoadFileFromLink('https://example.com/file'))
        await waitFor(() => expect(result.current.files).toEqual([]))
      } else {
        if (uploadKind === 'retry') act(() => result.current.handleReUploadFile('retry'))
        else {
          act(() =>
            result.current.handleLocalFileUpload(
              new File(['a'], 'one.txt', { type: 'text/plain' }),
            ),
          )
          await waitFor(() => expect(fileUpload).toHaveBeenCalled())
        }
        act(() => vi.mocked(fileUpload).mock.calls.at(-1)![0].onErrorCallback(error))
        expect(result.current.files[0]?.progress).toBe(-1)
      }
      expect(toast.error).not.toHaveBeenCalled()
      unmount()
      vi.mocked(fileUpload).mockClear()
    }
  },
)

it('keeps the original URL and infers the file type when remote metadata is nullable', async () => {
  request.mockResolvedValueOnce(Response.json({ ...uploadResponse, mime_type: null, url: null }))
  const { result } = setup()
  await act(async () => result.current.handleLoadFileFromLink('https://example.com/report.pdf'))
  await waitFor(() => expect(result.current.files[0]?.progress).toBe(100))
  expect(result.current.files[0]).toMatchObject({
    type: '',
    supportFileType: 'document',
    url: 'https://example.com/report.pdf',
    uploadedId: 'uploaded-file',
  })
  expect(new URL(request.mock.calls[0]![0]).pathname).toBe('/console/api/remote-files/upload')
  expect(uploadPublicRemoteFileInfo).not.toHaveBeenCalled()
})
