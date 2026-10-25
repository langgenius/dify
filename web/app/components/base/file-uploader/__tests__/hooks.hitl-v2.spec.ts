import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { act, renderHook as rtlRenderHook } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { useFile } from '../hooks'

const mockNotify = vi.fn()
const mockNavigationState = vi.hoisted(() => ({
  params: {} as { token?: string },
  pathname: '/chat',
}))
const mockFileUploadContext = vi.hoisted(() => ({
  localUploadUrl: undefined as string | undefined,
  remoteUploadUrl: undefined as string | undefined,
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => mockNavigationState.params,
  usePathname: () => mockNavigationState.pathname,
}))

vi.mock('../upload-context', () => ({
  useFileUploadContext: () => mockFileUploadContext,
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: (message: string) => mockNotify({ type: 'error', message }),
  },
}))

const mockSetFiles = vi.fn()
let mockStoreFiles: FileEntity[] = []
vi.mock('../store', () => ({
  useFileStore: () => ({
    getState: () => ({
      files: mockStoreFiles,
      setFiles: mockSetFiles,
    }),
  }),
}))

const mockFileUpload = vi.fn()
const mockIsAllowedFileExtension = vi.fn().mockReturnValue(true)
const mockGetSupportFileType = vi.fn().mockReturnValue('document')
vi.mock('../utils', () => ({
  fileUpload: (...args: unknown[]) => mockFileUpload(...args),
  getFileUploadErrorMessage: vi.fn().mockReturnValue('Upload error'),
  getSupportFileType: (...args: unknown[]) => mockGetSupportFileType(...args),
  isAllowedFileExtension: (...args: unknown[]) => mockIsAllowedFileExtension(...args),
}))

const mockUploadRemoteFileInfo = vi.fn()
vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: (...args: unknown[]) => mockUploadRemoteFileInfo(...args),
}))

const mockUploadHumanInputFormLocalFile = vi.fn()
const mockUploadHumanInputFormRemoteFileInfo = vi.fn()
vi.mock('@/service/share', () => ({
  uploadHumanInputFormLocalFile: (...args: unknown[]) => mockUploadHumanInputFormLocalFile(...args),
  uploadHumanInputFormRemoteFileInfo: (...args: unknown[]) =>
    mockUploadHumanInputFormRemoteFileInfo(...args),
}))

const mockHumanInputV2Transport = vi.hoisted(() => ({
  getForm: vi.fn(),
  requestAccess: vi.fn(),
  submit: vi.fn(),
  requestUploadToken: vi.fn(),
  uploadLocalFile: vi.fn(),
  uploadRemoteFile: vi.fn(),
}))
vi.mock('@/features/human-input-v2-form/transport-context', () => ({
  useHumanInputV2FormTransport: () => mockHumanInputV2Transport,
}))

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}))

const renderHook = <T>(callback: () => T) =>
  rtlRenderHook(callback, { wrapper: createConsoleQueryWrapper().wrapper })

describe('useFile', () => {
  const defaultFileConfig: FileUpload = {
    enabled: true,
    allowed_file_types: ['image', 'document'],
    allowed_file_extensions: [],
    number_limits: 5,
  } as FileUpload

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreFiles = []
    mockNavigationState.params = {}
    mockNavigationState.pathname = '/chat'
    mockFileUploadContext.localUploadUrl = undefined
    mockFileUploadContext.remoteUploadUrl = undefined
    mockIsAllowedFileExtension.mockReturnValue(true)
    mockGetSupportFileType.mockReturnValue('document')
    mockHumanInputV2Transport.requestUploadToken.mockResolvedValue({
      uploadToken: 'mock-upload-token',
      expiresAt: 999999,
    })
    mockHumanInputV2Transport.uploadLocalFile.mockImplementation((_token: string, file: File) =>
      Promise.resolve({
        id: 'v2-local-file',
        name: file.name,
        mimeType: file.type,
        size: file.size,
        url: '',
      }),
    )
    mockHumanInputV2Transport.uploadRemoteFile.mockImplementation((_token: string, url: string) =>
      Promise.resolve({
        id: 'v2-remote-file',
        name: 'remote.txt',
        mimeType: 'text/plain',
        size: 100,
        url,
      }),
    )
  })

  describe('handleLoadFileFromLink', () => {
    it('should use the v2 upload-token transport for a remote file on the form-v2 page', async () => {
      mockNavigationState.params = { token: 'v2-form-token' }
      mockNavigationState.pathname = '/form-v2/v2-form-token'

      const { result } = renderHook(() => useFile(defaultFileConfig))
      await act(async () => {
        result.current.handleLoadFileFromLink('https://example.com/file.txt')
      })

      expect(mockHumanInputV2Transport.uploadRemoteFile).toHaveBeenCalledWith(
        'v2-form-token',
        'https://example.com/file.txt',
      )
      expect(mockUploadHumanInputFormRemoteFileInfo).not.toHaveBeenCalled()
      expect(mockUploadRemoteFileInfo).not.toHaveBeenCalled()
    })
  })

  describe('handleLocalFileUpload', () => {
    let capturedListeners: Record<string, (() => void)[]>
    let mockReaderResult: string | null

    beforeEach(() => {
      capturedListeners = {}
      mockReaderResult = 'data:text/plain;base64,Y29udGVudA=='

      class MockFileReader {
        result: string | null = null
        addEventListener(event: string, handler: () => void) {
          if (!capturedListeners[event]) capturedListeners[event] = []
          capturedListeners[event].push(handler)
        }

        readAsDataURL() {
          this.result = mockReaderResult
          capturedListeners.load?.forEach((handler) => handler())
        }
      }
      vi.stubGlobal('FileReader', MockFileReader)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('should use the v2 upload-token transport for a local file on the form-v2 page', async () => {
      mockNavigationState.params = { token: 'v2-form-token' }
      mockNavigationState.pathname = '/form-v2/v2-form-token'
      const file = new File(['content'], 'test.txt', { type: 'text/plain' })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      await act(async () => {
        result.current.handleLocalFileUpload(file)
      })

      expect(mockHumanInputV2Transport.uploadLocalFile).toHaveBeenCalledWith('v2-form-token', file)
      expect(mockUploadHumanInputFormLocalFile).not.toHaveBeenCalled()
      expect(mockFileUpload).not.toHaveBeenCalled()
    })

    it('should not consume a route token for malformed form paths', () => {
      mockNavigationState.params = { token: 'unrelated-token' }
      mockNavigationState.pathname = '/form-v2/unrelated-token/extra'
      const file = new File(['content'], 'test.txt', { type: 'text/plain' })

      const { result } = renderHook(() => useFile(defaultFileConfig))
      result.current.handleLocalFileUpload(file)

      expect(mockFileUpload).toHaveBeenCalledWith(expect.any(Object), true, undefined)
      expect(mockHumanInputV2Transport.uploadLocalFile).not.toHaveBeenCalled()
      expect(mockUploadHumanInputFormLocalFile).not.toHaveBeenCalled()
    })
  })
})
