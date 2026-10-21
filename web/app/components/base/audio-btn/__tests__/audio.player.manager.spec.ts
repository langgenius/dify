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
      mockState.instances.push(this)
    }
  }
})

vi.mock('@/app/components/base/audio-btn/audio', () => ({
  AudioPlayer: MockAudioPlayer,
}))

describe('AudioPlayerManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.instances = []
  })

  describe('getAudioPlayer', () => {
    it('should reuse existing player and update callback when msg id is unchanged', () => {
      const manager = new AudioPlayerManager()
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

      expect(mockAudioPlayerConstructor).toHaveBeenCalledExactlyOnceWith(
        '/text-to-audio',
        false,
        'msg-1',
        'hello',
        'en-US',
        firstCallback,
      )
      expect(first).toBe(second)
      expect(mockState.instances[0]!.setCallback).toHaveBeenCalledTimes(1)
      expect(mockState.instances[0]!.setCallback).toHaveBeenCalledWith(secondCallback)
    })

    it('should cleanup existing player and create a new one when msg id changes', () => {
      const manager = new AudioPlayerManager()
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
      const manager = new AudioPlayerManager()
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
      const manager = new AudioPlayerManager()
      const callback = vi.fn()
      manager.getAudioPlayer('/text-to-audio', false, 'msg-1', 'hello', 'en-US', callback)

      manager.resetMsgId('msg-updated')

      expect(mockState.instances[0]!.resetMsgId).toHaveBeenCalledTimes(1)
      expect(mockState.instances[0]!.resetMsgId).toHaveBeenCalledWith('msg-updated')
      const reused = manager.getAudioPlayer(
        '/text-to-audio',
        false,
        'msg-updated',
        'hello',
        'en-US',
        callback,
      )
      expect(reused).toBe(mockState.instances[0])
      expect(mockAudioPlayerConstructor).toHaveBeenCalledTimes(1)
    })
  })
})
