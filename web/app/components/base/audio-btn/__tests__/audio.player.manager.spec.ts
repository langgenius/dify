import { AudioPlayerManager } from '../audio.player.manager'

type AudioCallback = ((event: string) => void) | null
type AudioPlayerCtorArgs = [
  string,
  boolean,
  string | undefined,
  string | null | undefined,
  string | undefined,
  AudioCallback,
]

type MockAudioPlayerInstance = {
  setCallback: ReturnType<typeof vi.fn>
  pauseAudio: ReturnType<typeof vi.fn>
  resetMsgId: ReturnType<typeof vi.fn>
  cacheBuffers: Array<ArrayBuffer>
  sourceBuffer: {
    abort: ReturnType<typeof vi.fn>
  } | undefined
}

const mockState = vi.hoisted(() => ({
  instances: [] as MockAudioPlayerInstance[],
}))

const mockAudioPlayerConstructor = vi.hoisted(() => vi.fn())

const MockAudioPlayer = vi.hoisted(() => {
  return class MockAudioPlayerClass {
    setCallback = vi.fn()
    pauseAudio = vi.fn()
    resetMsgId = vi.fn()
    cacheBuffers = [new ArrayBuffer(1)]
    sourceBuffer = { abort: vi.fn() }

    constructor(...args: AudioPlayerCtorArgs) {
      mockAudioPlayerConstructor(...args)
      mockState.instances.push(this as unknown as MockAudioPlayerInstance)
    }
  }
})

vi.mock('@/app/components/base/audio-btn/audio', () => ({
  default: MockAudioPlayer,
}))

describe('AudioPlayerManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.instances = []
    Reflect.set(AudioPlayerManager, 'instance', undefined)
  })

  describe('getInstance', () => {
    it('should return the same singleton instance across calls', () => {
      const first = AudioPlayerManager.getInstance()
      const second = AudioPlayerManager.getInstance()

      expect(first).toBe(second)
    })
  })

  describe('getAudioPlayer', () => {
    it('should create a new audio player when no existing player is cached', () => {
      const manager = AudioPlayerManager.getInstance()
      const callback = vi.fn()

      const result = manager.getAudioPlayer('/text-to-audio', false, 'msg-1', 'hello', 'en-US', callback)

      expect(mockAudioPlayerConstructor).toHaveBeenCalledTimes(1)
      expect(mockAudioPlayerConstructor).toHaveBeenCalledWith(
        '/text-to-audio',
        false,
        'msg-1',
        'hello',
        'en-US',
        callback,
      )
      expect(result).toBe(mockState.instances[0])
    })

    it('should reuse existing player and update callback when msg id is unchanged', () => {
      const manager = AudioPlayerManager.getInstance()
      const firstCallback = vi.fn()
      const secondCallback = vi.fn()

      const first = manager.getAudioPlayer('/text-to-audio', false, 'msg-1', 'hello', 'en-US', firstCallback)
      const second = manager.getAudioPlayer('/ignored', true, 'msg-1', 'ignored', 'fr-FR', secondCallback)

      expect(mockAudioPlayerConstructor).toHaveBeenCalledTimes(1)
      expect(first).toBe(second)
      expect(mockState.instances[0].setCallback).toHaveBeenCalledTimes(1)
      expect(mockState.instances[0].setCallback).toHaveBeenCalledWith(secondCallback)
    })

    it('should cleanup existing player and create a new one when msg id changes', () => {
      const manager = AudioPlayerManager.getInstance()
      const callback = vi.fn()
      manager.getAudioPlayer('/text-to-audio', false, 'msg-1', 'hello', 'en-US', callback)
      const previous = mockState.instances[0]

      const next = manager.getAudioPlayer('/apps/1/text-to-audio', false, 'msg-2', 'world', 'en-US', callback)

      expect(previous.pauseAudio).toHaveBeenCalledTimes(1)
      expect(previous.cacheBuffers).toEqual([])
      expect(previous.sourceBuffer?.abort).toHaveBeenCalledTimes(1)
      expect(mockAudioPlayerConstructor).toHaveBeenCalledTimes(2)
      expect(next).toBe(mockState.instances[1])
    })

    it('should swallow cleanup errors and still create a new player', () => {
      const manager = AudioPlayerManager.getInstance()
      const callback = vi.fn()
      manager.getAudioPlayer('/text-to-audio', false, 'msg-1', 'hello', 'en-US', callback)
      const previous = mockState.instances[0]
      previous.pauseAudio.mockImplementation(() => {
        throw new Error('cleanup failure')
      })

      expect(() => {
        manager.getAudioPlayer('/apps/1/text-to-audio', false, 'msg-2', 'world', 'en-US', callback)
      }).not.toThrow()

      expect(previous.pauseAudio).toHaveBeenCalledTimes(1)
      expect(mockAudioPlayerConstructor).toHaveBeenCalledTimes(2)
    })
  })

  describe('resetMsgId', () => {
    it('should forward reset message id to the cached audio player when present', () => {
      const manager = AudioPlayerManager.getInstance()
      const callback = vi.fn()
      manager.getAudioPlayer('/text-to-audio', false, 'msg-1', 'hello', 'en-US', callback)

      manager.resetMsgId('msg-updated')

      expect(mockState.instances[0].resetMsgId).toHaveBeenCalledTimes(1)
      expect(mockState.instances[0].resetMsgId).toHaveBeenCalledWith('msg-updated')
    })

    it('should not throw when resetting message id without an audio player', () => {
      const manager = AudioPlayerManager.getInstance()

      expect(() => manager.resetMsgId('msg-updated')).not.toThrow()
    })
  })
})
