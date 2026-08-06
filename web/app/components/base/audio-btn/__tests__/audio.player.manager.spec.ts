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
  destroy: ReturnType<typeof vi.fn>
  resetMsgId: ReturnType<typeof vi.fn>
}

const mockState = vi.hoisted(() => ({
  instances: [] as MockAudioPlayerInstance[],
}))

const mockAudioPlayerConstructor = vi.hoisted(() => vi.fn())

const MockAudioPlayer = vi.hoisted(() => {
  return class MockAudioPlayerClass {
    setCallback = vi.fn()
    destroy = vi.fn()
    resetMsgId = vi.fn()

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

      const result = manager.getAudioPlayer(
        '/text-to-audio',
        false,
        'msg-1',
        'hello',
        'en-US',
        callback,
      )

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

      const first = manager.getAudioPlayer(
        '/text-to-audio',
        false,
        'msg-1',
        'hello',
        'en-US',
        firstCallback,
      )
      const second = manager.getAudioPlayer(
        '/ignored',
        true,
        'msg-1',
        'ignored',
        'fr-FR',
        secondCallback,
      )

      expect(mockAudioPlayerConstructor).toHaveBeenCalledTimes(1)
      expect(first).toBe(second)
      expect(mockState.instances[0]!.setCallback).toHaveBeenCalledTimes(1)
      expect(mockState.instances[0]!.setCallback).toHaveBeenCalledWith(secondCallback)
    })

    it('should cleanup existing player and create a new one when msg id changes', () => {
      const manager = AudioPlayerManager.getInstance()
      const callback = vi.fn()
      manager.getAudioPlayer('/text-to-audio', false, 'msg-1', 'hello', 'en-US', callback)
      const previous = mockState.instances[0]

      const next = manager.getAudioPlayer(
        '/apps/1/text-to-audio',
        false,
        'msg-2',
        'world',
        'en-US',
        callback,
      )

      expect(previous!.destroy).toHaveBeenCalledTimes(1)
      expect(mockAudioPlayerConstructor).toHaveBeenCalledTimes(2)
      expect(next).toBe(mockState.instances[1])
    })

    it('should swallow cleanup errors and still create a new player', () => {
      const manager = AudioPlayerManager.getInstance()
      const callback = vi.fn()
      manager.getAudioPlayer('/text-to-audio', false, 'msg-1', 'hello', 'en-US', callback)
      const previous = mockState.instances[0]
      previous!.destroy.mockImplementation(() => {
        throw new Error('cleanup failure')
      })

      expect(() => {
        manager.getAudioPlayer('/apps/1/text-to-audio', false, 'msg-2', 'world', 'en-US', callback)
      }).not.toThrow()

      expect(previous!.destroy).toHaveBeenCalledTimes(1)
      expect(mockAudioPlayerConstructor).toHaveBeenCalledTimes(2)
    })
  })

  describe('resetMsgId', () => {
    it('should forward reset message id to the cached audio player when present', () => {
      const manager = AudioPlayerManager.getInstance()
      const callback = vi.fn()
      manager.getAudioPlayer('/text-to-audio', false, 'msg-1', 'hello', 'en-US', callback)

      manager.resetMsgId('msg-updated')

      expect(mockState.instances[0]!.resetMsgId).toHaveBeenCalledTimes(1)
      expect(mockState.instances[0]!.resetMsgId).toHaveBeenCalledWith('msg-updated')
    })

    it('should not throw when resetting message id without an audio player', () => {
      const manager = AudioPlayerManager.getInstance()

      expect(() => manager.resetMsgId('msg-updated')).not.toThrow()
    })
  })

  describe('automatic playback ownership', () => {
    it('should release only the active automatic playback player', () => {
      const manager = AudioPlayerManager.getInstance()
      const player = manager.getAutoPlayAudioPlayer(
        '/text-to-audio',
        false,
        'auto-1',
        'hello',
        'en-US',
        null,
      )

      manager.destroyAutoPlayAudioPlayer(player)

      expect(mockState.instances[0]!.destroy).toHaveBeenCalledTimes(1)

      manager.getAudioPlayer('/text-to-audio', false, 'next', 'world', 'en-US', null)
      expect(mockAudioPlayerConstructor).toHaveBeenCalledTimes(2)
    })

    it('should not release an automatic player after another player replaced it', () => {
      const manager = AudioPlayerManager.getInstance()
      const player = manager.getAutoPlayAudioPlayer(
        '/text-to-audio',
        false,
        'auto-1',
        'hello',
        'en-US',
        null,
      )
      manager.getAudioPlayer('/text-to-audio', false, 'manual-1', 'world', 'en-US', null)

      manager.destroyAutoPlayAudioPlayer(player)

      expect(mockState.instances[0]!.destroy).toHaveBeenCalledTimes(1)
      expect(mockState.instances[1]!.destroy).not.toHaveBeenCalled()
    })

    it('should release the current automatic player without requiring its owner', () => {
      const manager = AudioPlayerManager.getInstance()
      manager.getAutoPlayAudioPlayer('/text-to-audio', false, 'auto-1', 'hello', 'en-US', null)

      manager.destroyCurrentAutoPlayAudioPlayer()

      expect(mockState.instances[0]!.destroy).toHaveBeenCalledTimes(1)
    })
  })
})
