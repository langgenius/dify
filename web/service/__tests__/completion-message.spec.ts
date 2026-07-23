import { sendCompletionMessage as sendDebugCompletionMessage } from '../debug'
import { AppSourceType, sendCompletionMessage as sendSharedCompletionMessage } from '../share'

const { ssePostMock } = vi.hoisted(() => ({
  ssePostMock: vi.fn(),
}))

vi.mock('../base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../base')>()
  return {
    ...actual,
    ssePost: ssePostMock,
  }
})

const createCallbacks = () => ({
  onData: vi.fn(),
  onCompleted: vi.fn(),
  onError: vi.fn(),
  onMessageReplace: vi.fn(),
  onTTSChunk: vi.fn(),
  onTTSEnd: vi.fn(),
  getAbortController: vi.fn(),
})

describe('completion message services', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ssePostMock.mockResolvedValue(undefined)
  })

  it('should forward tts callbacks for app debugging', async () => {
    const callbacks = createCallbacks()

    await sendDebugCompletionMessage('app-1', { inputs: { query: 'hello' } }, callbacks)

    expect(ssePostMock).toHaveBeenCalledWith(
      'apps/app-1/completion-messages',
      { body: { inputs: { query: 'hello' }, response_mode: 'streaming' } },
      expect.objectContaining({
        onTTSChunk: callbacks.onTTSChunk,
        onTTSEnd: callbacks.onTTSEnd,
        getAbortController: callbacks.getAbortController,
      }),
    )
  })

  it('should forward tts callbacks for shared text-generation apps', async () => {
    const callbacks = createCallbacks()

    await sendSharedCompletionMessage(
      { inputs: { query: 'hello' } },
      callbacks,
      AppSourceType.installedApp,
      'installed-1',
    )

    expect(ssePostMock).toHaveBeenCalledWith(
      'installed-apps/installed-1/completion-messages',
      { body: { inputs: { query: 'hello' }, response_mode: 'streaming' } },
      expect.objectContaining({
        isPublicAPI: false,
        onTTSChunk: callbacks.onTTSChunk,
        onTTSEnd: callbacks.onTTSEnd,
        getAbortController: callbacks.getAbortController,
      }),
    )
  })
})
