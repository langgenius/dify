import type { TFunction } from 'i18next'
import { waitFor } from '@testing-library/react'
import { upload } from '@/service/base'
import { getImageUploadErrorMessage, imageUpload } from './utils'

vi.mock('@/service/base', () => ({
  upload: vi.fn(),
}))

describe('image-uploader utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getImageUploadErrorMessage', () => {
    it('should return backend message when error code is forbidden', () => {
      const t = vi.fn() as unknown as TFunction

      const result = getImageUploadErrorMessage(
        { response: { code: 'forbidden', message: 'Forbidden by policy' } },
        'Default error',
        t,
      )

      expect(result).toBe('Forbidden by policy')
      expect(t).not.toHaveBeenCalled()
    })

    it('should return translated message when error code is file_extension_blocked', () => {
      const t = vi.fn(() => 'common.fileUploader.fileExtensionBlocked') as unknown as TFunction

      const result = getImageUploadErrorMessage(
        { response: { code: 'file_extension_blocked' } },
        'Default error',
        t,
      )

      expect(result).toBe('common.fileUploader.fileExtensionBlocked')
      expect(t).toHaveBeenCalledWith('fileUploader.fileExtensionBlocked', { ns: 'common' })
    })

    it('should return default message when error code is unknown', () => {
      const t = vi.fn() as unknown as TFunction

      const result = getImageUploadErrorMessage(
        { response: { code: 'unexpected_error' } },
        'Default error',
        t,
      )

      expect(result).toBe('Default error')
      expect(t).not.toHaveBeenCalled()
    })

    it('should return default message when error is missing response code', () => {
      const t = vi.fn() as unknown as TFunction

      const result = getImageUploadErrorMessage(undefined, 'Default error', t)

      expect(result).toBe('Default error')
      expect(t).not.toHaveBeenCalled()
    })
  })

  describe('imageUpload', () => {
    const createCallbacks = () => ({
      onProgressCallback: vi.fn<(progress: number) => void>(),
      onSuccessCallback: vi.fn<(res: { id: string }) => void>(),
      onErrorCallback: vi.fn<(error?: unknown) => void>(),
    })

    it('should upload file and call success callback', async () => {
      const file = new File(['hello'], 'image.png', { type: 'image/png' })
      const callbacks = createCallbacks()
      vi.mocked(upload).mockResolvedValue({ id: 'uploaded-id' })

      imageUpload({ file, ...callbacks }, true, '/files/upload')

      expect(upload).toHaveBeenCalledTimes(1)

      const [options, isPublic, url] = vi.mocked(upload).mock.calls[0]
      expect(isPublic).toBe(true)
      expect(url).toBe('/files/upload')
      expect(options.xhr).toBeInstanceOf(XMLHttpRequest)
      expect(options.data).toBeInstanceOf(FormData)
      expect((options.data as FormData).get('file')).toBe(file)

      await waitFor(() => {
        expect(callbacks.onSuccessCallback).toHaveBeenCalledWith({ id: 'uploaded-id' })
      })
      expect(callbacks.onErrorCallback).not.toHaveBeenCalled()
    })

    it('should call error callback when upload fails', async () => {
      const file = new File(['hello'], 'image.png', { type: 'image/png' })
      const callbacks = createCallbacks()
      const error = new Error('Upload failed')
      vi.mocked(upload).mockRejectedValue(error)

      imageUpload({ file, ...callbacks })

      await waitFor(() => {
        expect(callbacks.onErrorCallback).toHaveBeenCalledWith(error)
      })
      expect(callbacks.onSuccessCallback).not.toHaveBeenCalled()
    })

    it('should report progress percentage when progress is computable', () => {
      const file = new File(['hello'], 'image.png', { type: 'image/png' })
      const callbacks = createCallbacks()
      vi.mocked(upload).mockImplementation((options: { onprogress?: (e: ProgressEvent) => void }) => {
        options.onprogress?.({ lengthComputable: true, loaded: 5, total: 8 } as ProgressEvent)
        return Promise.resolve({ id: 'uploaded-id' })
      })

      imageUpload({ file, ...callbacks })

      expect(callbacks.onProgressCallback).toHaveBeenCalledWith(62)
    })

    it('should not report progress when length is not computable', () => {
      const file = new File(['hello'], 'image.png', { type: 'image/png' })
      const callbacks = createCallbacks()
      vi.mocked(upload).mockImplementation((options: { onprogress?: (e: ProgressEvent) => void }) => {
        options.onprogress?.({ lengthComputable: false, loaded: 5, total: 8 } as ProgressEvent)
        return Promise.resolve({ id: 'uploaded-id' })
      })

      imageUpload({ file, ...callbacks })

      expect(callbacks.onProgressCallback).not.toHaveBeenCalled()
    })
  })
})
