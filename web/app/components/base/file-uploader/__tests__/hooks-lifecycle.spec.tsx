import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { toast } from '@langgenius/dify-ui/toast'
import { act, renderHook } from '@testing-library/react'
import { uploadRemoteFileInfo } from '@/service/common'
import { TransferMethod } from '@/types/app'
import { useFile } from '../hooks'
import { FileContextProvider } from '../store'
import { fileUpload } from '../utils'

const onChange = vi.fn()

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/chat',
}))
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: vi.fn() },
}))
vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils')>()),
  fileUpload: vi.fn(),
}))
vi.mock('@/service/common', () => ({ uploadRemoteFileInfo: vi.fn() }))

const fileConfig: FileUpload = {
  enabled: true,
  allowed_file_types: ['document'],
  number_limits: 3,
}

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const renderFile = (value: FileEntity[] = []) =>
  renderHook(() => useFile(fileConfig), {
    wrapper: ({ children }) => (
      <FileContextProvider value={value} onChange={onChange}>
        {children}
      </FileContextProvider>
    ),
  })

describe('file uploads after unmount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('remote uploads', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.clearAllTimers()
      vi.useRealTimers()
    })

    it.each(['success', 'error'] as const)(
      'should ignore remote upload %s after unmount',
      async (outcome) => {
        const pending = createDeferred<Awaited<ReturnType<typeof uploadRemoteFileInfo>>>()
        vi.mocked(uploadRemoteFileInfo).mockReturnValue(pending.promise)
        const { result, unmount } = renderFile()
        act(() => result.current.handleLoadFileFromLink('https://example.com/file.txt'))

        unmount()
        onChange.mockClear()
        await act(async () => {
          if (outcome === 'success') {
            pending.resolve({
              id: 'remote-file',
              name: 'unsupported.exe',
              mime_type: 'application/octet-stream',
              size: 100,
              url: 'https://example.com/file.txt',
            })
          } else {
            pending.reject(new Error('Upload failed'))
          }
        })

        expect(onChange).not.toHaveBeenCalled()
        expect(toast.error).not.toHaveBeenCalled()
      },
    )

    it('should stop remote upload progress after unmount', () => {
      vi.mocked(uploadRemoteFileInfo).mockReturnValue(new Promise(() => {}))
      const { result, unmount } = renderFile()
      act(() => result.current.handleLoadFileFromLink('https://example.com/file.txt'))

      unmount()
      onChange.mockClear()
      act(() => vi.advanceTimersByTime(200))

      expect(onChange).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('local uploads', () => {
    let readers: FileReader[]

    beforeEach(() => {
      readers = []
      vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(
        function (this: FileReader) {
          readers.push(this)
        },
      )
    })

    it('should skip uploads when file reading finishes after unmount', () => {
      const { result, unmount } = renderFile()
      result.current.handleLocalFileUpload(
        new File(['content'], 'file.txt', { type: 'text/plain' }),
      )

      unmount()
      readers[0]!.dispatchEvent(new ProgressEvent('load'))

      expect(fileUpload).not.toHaveBeenCalled()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should ignore file reading errors after unmount', () => {
      const { result, unmount } = renderFile()
      result.current.handleLocalFileUpload(
        new File(['content'], 'file.txt', { type: 'text/plain' }),
      )

      unmount()
      readers[0]!.dispatchEvent(new ProgressEvent('error'))

      expect(toast.error).not.toHaveBeenCalled()
    })

    it('should ignore local upload errors after unmount', () => {
      const { result, unmount } = renderFile()
      result.current.handleLocalFileUpload(
        new File(['content'], 'file.txt', { type: 'text/plain' }),
      )
      act(() => readers[0]!.dispatchEvent(new ProgressEvent('load')))
      const { onErrorCallback } = vi.mocked(fileUpload).mock.calls[0]![0]

      unmount()
      onChange.mockClear()
      act(() => onErrorCallback(new Error('Upload failed')))

      expect(onChange).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('should ignore retry errors after unmount', () => {
      const file: FileEntity = {
        id: 'failed-file',
        name: 'file.txt',
        type: 'text/plain',
        size: 100,
        progress: -1,
        transferMethod: TransferMethod.local_file,
        supportFileType: 'document',
        originalFile: new File(['content'], 'file.txt', { type: 'text/plain' }),
      }
      const { result, unmount } = renderFile([file])
      act(() => result.current.handleReUploadFile(file.id))
      const { onErrorCallback } = vi.mocked(fileUpload).mock.calls[0]![0]

      unmount()
      onChange.mockClear()
      act(() => onErrorCallback(new Error('Upload failed')))

      expect(onChange).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
