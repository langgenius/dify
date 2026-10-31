import { createLegacyFormUploadStrategy } from '../legacy-upload'
import { createMockHumanInputV2FormTransport } from '../mock-transport'
import { createHumanInputV2UploadStrategy } from '../upload'

const legacyUploads = vi.hoisted(() => ({
  local: vi.fn(),
  remote: vi.fn(),
}))

vi.mock('@/service/share', () => ({
  uploadHumanInputFormLocalFile: legacyUploads.local,
  uploadHumanInputFormRemoteFileInfo: legacyUploads.remote,
}))

describe('public form upload strategies', () => {
  beforeEach(() => {
    legacyUploads.local.mockReset()
    legacyUploads.remote.mockReset()
  })

  it('binds local and linked legacy uploads to the owning form token', async () => {
    const strategy = createLegacyFormUploadStrategy('legacy-form')
    const file = new File(['review'], 'review.txt', { type: 'text/plain' })
    const callbacks = {
      file,
      onProgressCallback: vi.fn(),
      onSuccessCallback: vi.fn(),
      onErrorCallback: vi.fn(),
    }
    const remoteFile = {
      id: 'legacy-file',
      name: 'review.txt',
      mime_type: 'text/plain',
      size: 6,
      url: 'https://files.example/review.txt',
    }
    legacyUploads.remote.mockResolvedValue(remoteFile)

    strategy.uploadLocal(callbacks)
    expect(legacyUploads.local).toHaveBeenCalledExactlyOnceWith({
      formToken: 'legacy-form',
      ...callbacks,
    })
    await expect(strategy.uploadRemote('https://example.com/review.txt')).resolves.toEqual(
      remoteFile,
    )
    expect(legacyUploads.remote).toHaveBeenCalledExactlyOnceWith(
      'legacy-form',
      'https://example.com/review.txt',
    )
  })

  it('adapts v2 transport files to the shared uploader response', async () => {
    const transport = createMockHumanInputV2FormTransport()
    const uploadedFile = {
      id: 'v2-file',
      name: 'review.txt',
      mimeType: 'text/plain',
      size: 6,
      url: 'https://files.example/review.txt',
    }
    const local = vi.spyOn(transport, 'uploadLocalFile').mockResolvedValue(uploadedFile)
    const remote = vi.spyOn(transport, 'uploadRemoteFile').mockResolvedValue(uploadedFile)
    const strategy = createHumanInputV2UploadStrategy('v2-form', transport)
    const file = new File(['review'], 'review.txt', { type: 'text/plain' })
    const success = vi.fn()
    const progress = vi.fn()
    strategy.uploadLocal({
      file,
      onProgressCallback: progress,
      onSuccessCallback: success,
      onErrorCallback: vi.fn(),
    })

    await vi.waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'v2-file',
          mime_type: 'text/plain',
          source_url: uploadedFile.url,
          extension: 'txt',
        }),
      ),
    )
    expect(local).toHaveBeenCalledExactlyOnceWith('v2-form', file)
    expect(progress).toHaveBeenLastCalledWith(100)
    await expect(strategy.uploadRemote('https://example.com/review.txt')).resolves.toEqual({
      id: 'v2-file',
      name: 'review.txt',
      mime_type: 'text/plain',
      size: 6,
      url: uploadedFile.url,
    })
    expect(remote).toHaveBeenCalledExactlyOnceWith('v2-form', 'https://example.com/review.txt')
  })

  it('reports failed v2 local and remote uploads without invoking the legacy protocol', async () => {
    const transport = createMockHumanInputV2FormTransport()
    const expired = new Error('Form expired')
    vi.spyOn(transport, 'uploadLocalFile').mockRejectedValue(expired)
    vi.spyOn(transport, 'uploadRemoteFile').mockRejectedValue(expired)
    const strategy = createHumanInputV2UploadStrategy('expired-v2-form', transport)
    const success = vi.fn()
    const error = vi.fn()

    strategy.uploadLocal({
      file: new File(['review'], 'review.txt'),
      onProgressCallback: vi.fn(),
      onSuccessCallback: success,
      onErrorCallback: error,
    })

    await vi.waitFor(() => expect(error).toHaveBeenCalledExactlyOnceWith(expired))
    expect(success).not.toHaveBeenCalled()
    await expect(strategy.uploadRemote('https://example.com/review.txt')).rejects.toBe(expired)
    expect(legacyUploads.local).not.toHaveBeenCalled()
    expect(legacyUploads.remote).not.toHaveBeenCalled()
  })
})
