import { Buffer } from 'node:buffer'
import { waitFor } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import AudioPlayer from '../audio'

const mockTextToAudioStream = vi.hoisted(() => vi.fn())

vi.mock('@/service/share', () => ({
  AppSourceType: {
    webApp: 'webApp',
    installedApp: 'installedApp',
  },
  textToAudioStream: (...args: unknown[]) => mockTextToAudioStream(...args),
}))

type AudioEventName =
  | 'ended'
  | 'pause'
  | 'loaded'
  | 'play'
  | 'timeupdate'
  | 'loadeddate'
  | 'canplay'
  | 'error'
  | 'sourceopen'
  | 'updateend'

type AudioEventListener = () => void

type ReaderResult = {
  value: Uint8Array | undefined
  done: boolean
}

type Reader = {
  read: () => Promise<ReaderResult>
}

type AudioResponse = {
  status: number
  body: {
    getReader: () => Reader
  }
}

class MockSourceBuffer {
  updating = false
  private listeners: Partial<Record<AudioEventName, AudioEventListener[]>> = {}

  addEventListener = vi.fn((event: AudioEventName, listener: AudioEventListener) => {
    const listeners = this.listeners[event] || []
    listeners.push(listener)
    this.listeners[event] = listeners
  })

  removeEventListener = vi.fn((event: AudioEventName, listener: AudioEventListener) => {
    this.listeners[event] = (this.listeners[event] || []).filter((item) => item !== listener)
  })

  appendBuffer = vi.fn((_buffer: ArrayBuffer) => undefined)
  abort = vi.fn(() => undefined)

  emit(event: AudioEventName) {
    const listeners = this.listeners[event] || []
    listeners.forEach((listener) => {
      listener()
    })
  }
}

class MockMediaSource {
  readyState: 'open' | 'closed' | 'ended' = 'closed'
  sourceBuffer = new MockSourceBuffer()
  private listeners: Partial<Record<AudioEventName, AudioEventListener[]>> = {}

  addEventListener = vi.fn((event: AudioEventName, listener: AudioEventListener) => {
    const listeners = this.listeners[event] || []
    listeners.push(listener)
    this.listeners[event] = listeners
  })

  removeEventListener = vi.fn((event: AudioEventName, listener: AudioEventListener) => {
    this.listeners[event] = (this.listeners[event] || []).filter((item) => item !== listener)
  })

  addSourceBuffer = vi.fn((_contentType: string) => this.sourceBuffer)
  endOfStream = vi.fn(() => undefined)

  emit(event: AudioEventName) {
    if (event === 'sourceopen') this.readyState = 'open'
    const listeners = this.listeners[event] || []
    listeners.forEach((listener) => {
      listener()
    })
  }
}

class MockAudio {
  src = ''
  autoplay = false
  disableRemotePlayback = false
  controls = false
  paused = true
  ended = false
  played: unknown = null
  private listeners: Partial<Record<AudioEventName, AudioEventListener[]>> = {}

  addEventListener = vi.fn((event: AudioEventName, listener: AudioEventListener) => {
    const listeners = this.listeners[event] || []
    listeners.push(listener)
    this.listeners[event] = listeners
  })

  play = vi.fn(async () => {
    this.paused = false
  })

  pause = vi.fn(() => {
    this.paused = true
  })

  emit(event: AudioEventName) {
    const listeners = this.listeners[event] || []
    listeners.forEach((listener) => {
      listener()
    })
  }
}

class MockAudioContext {
  state: 'interrupted' | 'running' | 'suspended' = 'running'
  destination = {}
  connect = vi.fn(() => undefined)
  createMediaElementSource = vi.fn((_audio: MockAudio) => ({
    connect: this.connect,
  }))

  resume = vi.fn(async () => {
    this.state = 'running'
  })

  suspend = vi.fn(async () => {
    this.state = 'suspended'
  })

  close = vi.fn(async () => undefined)
}

const testState = {
  mediaSources: [] as MockMediaSource[],
  audios: [] as MockAudio[],
  audioContexts: [] as MockAudioContext[],
}

class MockMediaSourceCtor extends MockMediaSource {
  static isTypeSupported = vi.fn(() => true)

  constructor() {
    super()
    testState.mediaSources.push(this)
  }
}

class MockAudioCtor extends MockAudio {
  constructor() {
    super()
    testState.audios.push(this)
  }
}

class MockAudioContextCtor extends MockAudioContext {
  constructor() {
    super()
    testState.audioContexts.push(this)
  }
}

const originalAudio = globalThis.Audio
const originalAudioContext = globalThis.AudioContext
const originalCreateObjectURL = globalThis.URL.createObjectURL
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL
const originalMediaSource = window.MediaSource
const originalManagedMediaSource = window.ManagedMediaSource

const setMediaSourceSupport = (options: { mediaSource: boolean; managedMediaSource: boolean }) => {
  Object.defineProperty(window, 'MediaSource', {
    configurable: true,
    writable: true,
    value: options.mediaSource ? MockMediaSourceCtor : undefined,
  })
  Object.defineProperty(window, 'ManagedMediaSource', {
    configurable: true,
    writable: true,
    value: options.managedMediaSource ? MockMediaSourceCtor : undefined,
  })
}

const makeAudioResponse = (status: number, reads: ReaderResult[]): AudioResponse => {
  const read = vi.fn<() => Promise<ReaderResult>>()
  reads.forEach((result) => {
    read.mockResolvedValueOnce(result)
  })

  return {
    status,
    body: {
      getReader: () => ({ read }),
    },
  }
}

describe('AudioPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.mediaSources = []
    testState.audios = []
    testState.audioContexts = []
    MockMediaSourceCtor.isTypeSupported.mockReturnValue(true)

    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      writable: true,
      value: MockAudioCtor,
    })
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: MockAudioContextCtor,
    })
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock-url'),
    })
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })

    setMediaSourceSupport({ mediaSource: true, managedMediaSource: false })
  })

  afterAll(() => {
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      writable: true,
      value: originalAudio,
    })
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: originalAudioContext,
    })
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    })
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    })
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      writable: true,
      value: originalMediaSource,
    })
    Object.defineProperty(window, 'ManagedMediaSource', {
      configurable: true,
      writable: true,
      value: originalManagedMediaSource,
    })
  })

  describe('constructor behavior', () => {
    it('should initialize media source, audio, and media element source when MediaSource exists', () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]
      const mediaSource = testState.mediaSources[0]

      expect(player.mediaSource).toBe(mediaSource as unknown as MediaSource)
      expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1)
      expect(audio!.src).toBe('blob:mock-url')
      expect(audio!.autoplay).toBe(true)
      expect(audioContext!.createMediaElementSource).toHaveBeenCalledWith(audio)
      expect(audioContext!.connect).toHaveBeenCalledTimes(1)
    })

    it('should use complete-audio fallback when no MediaSource implementation exists', () => {
      setMediaSourceSupport({ mediaSource: false, managedMediaSource: false })

      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const audio = testState.audios[0]

      expect(player.mediaSource).toBeNull()
      expect(audio!.src).toBe('')
      expect(audio!.autoplay).toBe(false)
      expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled()
    })

    it('should use complete-audio fallback when MP3 MediaSource is unsupported', () => {
      MockMediaSourceCtor.isTypeSupported.mockReturnValue(false)

      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const audio = testState.audios[0]

      expect(MockMediaSourceCtor.isTypeSupported).toHaveBeenCalledWith('audio/mpeg')
      expect(player.mediaSource).toBeNull()
      expect(testState.mediaSources).toHaveLength(0)
      expect(audio!.src).toBe('')
      expect(audio!.autoplay).toBe(false)
      expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled()
    })

    it('should configure fallback audio controls when ManagedMediaSource is used', () => {
      setMediaSourceSupport({ mediaSource: false, managedMediaSource: true })

      // Create with callback to ensure constructor path completes with fallback source.
      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, vi.fn())
      const audio = testState.audios[0]

      expect(player.mediaSource).not.toBeNull()
      expect(audio!.disableRemotePlayback).toBe(true)
      expect(audio!.controls).toBe(true)
    })

    it('should configure ManagedMediaSource when both media source implementations exist', () => {
      setMediaSourceSupport({ mediaSource: true, managedMediaSource: true })

      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, vi.fn())
      const audio = testState.audios[0]

      expect(player.mediaSource).not.toBeNull()
      expect(audio!.disableRemotePlayback).toBe(true)
      expect(audio!.controls).toBe(true)
    })
  })

  describe('event wiring', () => {
    it('should forward registered audio events to callback', () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]

      audio!.emit('play')
      audio!.emit('ended')
      audio!.emit('error')
      audio!.emit('pause')
      audio!.emit('loaded')
      audio!.emit('timeupdate')
      audio!.emit('loadeddate')
      audio!.emit('canplay')

      expect(player.callback).toBe(callback)
      expect(callback).toHaveBeenCalledWith('play')
      expect(callback).toHaveBeenCalledWith('ended')
      expect(callback).toHaveBeenCalledWith('error')
      expect(callback).toHaveBeenCalledWith('paused')
      expect(callback).toHaveBeenCalledWith('loaded')
      expect(callback).toHaveBeenCalledWith('timeupdate')
      expect(callback).toHaveBeenCalledWith('loadeddate')
      expect(callback).toHaveBeenCalledWith('canplay')
    })

    it('should initialize source buffer only once when sourceopen fires multiple times', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', vi.fn())
      const mediaSource = testState.mediaSources[0]

      mediaSource!.emit('sourceopen')
      mediaSource!.emit('sourceopen')

      expect(mediaSource!.addSourceBuffer).toHaveBeenCalledTimes(1)
      expect(player.sourceBuffer).toBe(mediaSource!.sourceBuffer)
    })
  })

  describe('playback control', () => {
    it('should request streaming audio when playAudio is called before loading', async () => {
      mockTextToAudioStream.mockResolvedValue(
        makeAudioResponse(200, [
          { value: new Uint8Array([4, 5]), done: false },
          { value: new Uint8Array([1, 2, 3]), done: true },
        ]),
      )

      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', vi.fn())
      player.playAudio()

      await waitFor(() => {
        expect(mockTextToAudioStream).toHaveBeenCalledTimes(1)
      })

      expect(mockTextToAudioStream).toHaveBeenCalledWith(
        '/text-to-audio',
        AppSourceType.webApp,
        { content_type: 'audio/mpeg' },
        {
          message_id: 'msg-1',
          streaming: true,
          voice: 'en-US',
          text: 'hello',
        },
      )
      expect(player.isLoadData).toBe(true)
    })

    it('should emit error callback and reset load flag when stream response status is not 200', async () => {
      MockMediaSourceCtor.isTypeSupported.mockReturnValue(false)
      const callback = vi.fn()
      mockTextToAudioStream.mockResolvedValue(
        makeAudioResponse(500, [{ value: new Uint8Array([1]), done: true }]),
      )

      const player = new AudioPlayer('/text-to-audio', false, 'msg-2', 'world', undefined, callback)
      player.playAudio()

      await waitFor(() => {
        expect(callback).toHaveBeenCalledWith('error')
      })
      expect(player.isLoadData).toBe(false)
      expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled()
      expect(testState.audios[0]!.play).not.toHaveBeenCalled()
    })

    it('should play a complete MP3 blob when MediaSource does not support audio/mpeg', async () => {
      MockMediaSourceCtor.isTypeSupported.mockReturnValue(false)
      const callback = vi.fn()
      mockTextToAudioStream.mockResolvedValue(
        makeAudioResponse(200, [
          { value: new Uint8Array([1, 2]), done: false },
          { value: new Uint8Array([3, 4]), done: true },
        ]),
      )

      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, callback)
      const audio = testState.audios[0]

      player.playAudio()

      await waitFor(() => expect(audio!.play).toHaveBeenCalledTimes(1))
      expect(player.mediaSource).toBeNull()
      expect(player.cacheBuffers).toHaveLength(0)
      expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1)
      const audioBlob = vi.mocked(globalThis.URL.createObjectURL).mock.calls[0]![0] as Blob
      expect(audioBlob).toBeInstanceOf(Blob)
      expect(audioBlob).toMatchObject({ type: 'audio/mpeg', size: 4 })
      expect(new Uint8Array(await audioBlob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
      expect(audio!.src).toBe('blob:mock-url')
      expect(callback).toHaveBeenCalledWith('play')
    })

    it('should wait for the complete MP3 before retrying playback without MediaSource', async () => {
      MockMediaSourceCtor.isTypeSupported.mockReturnValue(false)
      let resolveResponse: ((response: AudioResponse) => void) | undefined
      mockTextToAudioStream.mockImplementationOnce(
        () =>
          new Promise<AudioResponse>((resolve) => {
            resolveResponse = resolve
          }),
      )

      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, vi.fn())
      const audio = testState.audios[0]

      player.playAudio()
      player.playAudio()

      expect(audio!.play).not.toHaveBeenCalled()

      resolveResponse?.(makeAudioResponse(200, [{ value: new Uint8Array([1, 2]), done: true }]))
      await waitFor(() => expect(audio!.play).toHaveBeenCalledTimes(1))
    })

    it.each(['suspended', 'interrupted'] as const)(
      'should resume and play immediately when playAudio is called in %s loaded state',
      async (audioContextState) => {
        const callback = vi.fn()
        const player = new AudioPlayer(
          '/text-to-audio',
          false,
          'msg-1',
          'hello',
          undefined,
          callback,
        )
        const audio = testState.audios[0]
        const audioContext = testState.audioContexts[0]

        player.isLoadData = true
        audioContext!.state = audioContextState
        player.playAudio()

        await waitFor(() => {
          expect(audioContext!.resume).toHaveBeenCalledTimes(1)
          expect(audio!.play).toHaveBeenCalledTimes(1)
          expect(callback).toHaveBeenCalledWith('play')
        })
      },
    )

    it('should request media playback before a suspended audio context finishes resuming', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]
      let resolveResume: (() => void) | undefined

      player.isLoadData = true
      audioContext!.state = 'suspended'
      audioContext!.resume.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveResume = () => {
              audioContext!.state = 'running'
              resolve()
            }
          }),
      )

      player.playAudio()

      expect(audioContext!.resume).toHaveBeenCalledTimes(1)
      expect(audio!.play).toHaveBeenCalledTimes(1)
      expect(callback).not.toHaveBeenCalledWith('play')

      resolveResume?.()
      await waitFor(() => expect(callback).toHaveBeenCalledWith('play'))
    })

    it.each(['suspended', 'interrupted'] as const)(
      'should resume a %s audio context when the media element is still playing',
      async (audioContextState) => {
        const callback = vi.fn()
        const player = new AudioPlayer(
          '/text-to-audio',
          false,
          'msg-1',
          'hello',
          undefined,
          callback,
        )
        const audio = testState.audios[0]
        const audioContext = testState.audioContexts[0]

        player.isLoadData = true
        audio!.paused = false
        audioContext!.state = audioContextState
        player.playAudio()

        await waitFor(() => {
          expect(audioContext!.resume).toHaveBeenCalledTimes(1)
          expect(callback).toHaveBeenCalledWith('play')
        })
        expect(audio!.play).not.toHaveBeenCalled()
      },
    )

    it('should report an error when the audio context remains interrupted and allow retry', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]

      player.isLoadData = true
      audio!.paused = false
      audioContext!.state = 'suspended'
      audioContext!.resume.mockImplementationOnce(async () => {
        audioContext!.state = 'interrupted'
      })
      player.playAudio()

      await waitFor(() => expect(callback).toHaveBeenCalledWith('error'))
      expect(callback).not.toHaveBeenCalledWith('play')

      audioContext!.resume.mockImplementationOnce(async () => {
        audioContext!.state = 'running'
      })
      player.playAudio()

      await waitFor(() => expect(callback).toHaveBeenCalledWith('play'))
      expect(audioContext!.resume).toHaveBeenCalledTimes(2)
      expect(audio!.play).not.toHaveBeenCalled()
    })

    it('should play ended audio when data is already loaded', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]

      player.isLoadData = true
      audioContext!.state = 'running'
      audio!.ended = true
      player.playAudio()

      await waitFor(() => {
        expect(audio!.play).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith('play')
      })
    })

    it('should report loaded audio that is already playing without replaying it', () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]

      player.isLoadData = true
      audioContext!.state = 'running'
      audio!.paused = false
      audio!.ended = false
      player.playAudio()

      expect(audio!.play).not.toHaveBeenCalled()
      expect(callback).toHaveBeenCalledWith('play')
    })

    it('should emit error callback when stream request throws', async () => {
      const callback = vi.fn()
      mockTextToAudioStream.mockRejectedValue(new Error('network failed'))
      const player = new AudioPlayer('/text-to-audio', false, 'msg-2', 'world', undefined, callback)

      player.playAudio()

      await waitFor(() => {
        expect(callback).toHaveBeenCalledWith('error')
      })
      expect(player.isLoadData).toBe(false)
    })

    it('should call pause flow and notify paused event when pauseAudio is invoked', () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]

      player.pauseAudio()

      expect(callback).toHaveBeenCalledWith('paused')
      expect(audio!.pause).toHaveBeenCalledTimes(1)
      expect(audioContext!.suspend).toHaveBeenCalledTimes(1)
    })
  })

  describe('message and direct-audio helpers', () => {
    it('should update message id through resetMsgId', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)

      player.resetMsgId('msg-2')

      expect(player.msgId).toBe('msg-2')
    })

    it('should end stream without playback when playAudioWithAudio receives empty content', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const mediaSource = testState.mediaSources[0]

      await player.playAudioWithAudio('', true)

      expect(player.isLoadData).toBe(false)
      expect(player.cacheBuffers).toHaveLength(0)
      expect(mediaSource!.endOfStream).not.toHaveBeenCalled()

      mediaSource!.emit('sourceopen')

      expect(mediaSource!.endOfStream).toHaveBeenCalledTimes(1)
      expect(callback).not.toHaveBeenCalledWith('play')
    })

    it('should decode base64 and start playback when playAudioWithAudio is called with playable content', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]
      const mediaSource = testState.mediaSources[0]
      const audioBase64 = Buffer.from('hello').toString('base64')

      mediaSource!.emit('sourceopen')
      audio!.paused = true
      audioContext!.state = 'suspended'
      await player.playAudioWithAudio(audioBase64, true)

      expect(player.isLoadData).toBe(true)
      expect(player.cacheBuffers).toHaveLength(0)
      expect(mediaSource!.sourceBuffer.appendBuffer).toHaveBeenCalledTimes(1)
      const appendedAudioData = mediaSource!.sourceBuffer.appendBuffer.mock.calls[0]![0]
      expect(appendedAudioData).toBeInstanceOf(ArrayBuffer)
      expect(appendedAudioData.byteLength).toBeGreaterThan(0)
      await waitFor(() => {
        expect(audioContext!.resume).toHaveBeenCalledTimes(1)
        expect(audio!.play).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith('play')
      })
    })

    it('should skip playback when playAudioWithAudio is called with play=false', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]

      await player.playAudioWithAudio(Buffer.from('hello').toString('base64'), false)

      expect(player.isLoadData).toBe(false)
      expect(audioContext!.resume).not.toHaveBeenCalled()
      expect(audio!.play).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalledWith('play')
    })

    it('should combine automatic TTS chunks into a playable MP3 blob without MediaSource', async () => {
      MockMediaSourceCtor.isTypeSupported.mockReturnValue(false)
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]

      await player.playAudioWithAudio(Buffer.from([1, 2]).toString('base64'), true)
      await player.playAudioWithAudio(Buffer.from([3, 4]).toString('base64'), true)

      expect(audio!.play).not.toHaveBeenCalled()
      expect(player.cacheBuffers).toHaveLength(2)

      await player.playAudioWithAudio('', false)

      await waitFor(() => expect(audio!.play).toHaveBeenCalledTimes(1))
      expect(player.cacheBuffers).toHaveLength(0)
      expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1)
      const audioBlob = vi.mocked(globalThis.URL.createObjectURL).mock.calls[0]![0] as Blob
      expect(audioBlob).toMatchObject({ type: 'audio/mpeg', size: 4 })
      expect(new Uint8Array(await audioBlob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
      expect(audio!.src).toBe('blob:mock-url')
      expect(callback).toHaveBeenCalledWith('play')
    })

    it('should not start fallback playback after it is paused while buffering', async () => {
      MockMediaSourceCtor.isTypeSupported.mockReturnValue(false)
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', vi.fn())
      const audio = testState.audios[0]

      await player.playAudioWithAudio(Buffer.from([1, 2]).toString('base64'), true)
      player.pauseAudio()
      await player.playAudioWithAudio('', false)

      expect(audio!.autoplay).toBe(false)
      expect(audio!.play).not.toHaveBeenCalled()
      expect(audio!.src).toBe('blob:mock-url')
    })

    it('should fall back to a complete MP3 when addSourceBuffer throws', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const mediaSource = testState.mediaSources[0]
      const audio = testState.audios[0]
      mediaSource!.addSourceBuffer.mockImplementationOnce(() => {
        throw new DOMException('Unsupported type', 'NotSupportedError')
      })

      mediaSource!.emit('sourceopen')
      await player.playAudioWithAudio(Buffer.from([1, 2]).toString('base64'), true)
      await player.playAudioWithAudio('', false)

      await waitFor(() => expect(audio!.play).toHaveBeenCalledTimes(1))
      expect(player.mediaSource).toBeNull()
      expect(audio!.autoplay).toBe(false)
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(2)
    })

    it('should complete buffered fallback when addSourceBuffer throws after stream end', async () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', vi.fn())
      const mediaSource = testState.mediaSources[0]
      const audio = testState.audios[0]
      mediaSource!.addSourceBuffer.mockImplementationOnce(() => {
        throw new DOMException('Unsupported type', 'NotSupportedError')
      })

      await player.playAudioWithAudio(Buffer.from([1, 2]).toString('base64'), true)
      await waitFor(() => expect(audio!.play).toHaveBeenCalledTimes(1))
      await player.playAudioWithAudio('', false)
      audio!.paused = true

      mediaSource!.emit('sourceopen')

      await waitFor(() => expect(audio!.play).toHaveBeenCalledTimes(2))
      expect(player.mediaSource).toBeNull()
      expect(player.cacheBuffers).toHaveLength(0)
      expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(2)
      const audioBlob = vi.mocked(globalThis.URL.createObjectURL).mock.calls[1]![0] as Blob
      expect(audioBlob).toMatchObject({ type: 'audio/mpeg', size: 2 })
      expect(new Uint8Array(await audioBlob.arrayBuffer())).toEqual(new Uint8Array([1, 2]))
    })

    it('should play immediately for ended audio in playAudioWithAudio', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]

      audio!.paused = false
      audio!.ended = true
      await player.playAudioWithAudio(Buffer.from('hello').toString('base64'), true)

      expect(audio!.play).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(callback).toHaveBeenCalledWith('play'))
    })

    it('should not replay when played list exists in playAudioWithAudio', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]

      audio!.paused = false
      audio!.ended = false
      audio!.played = {}
      await player.playAudioWithAudio(Buffer.from('hello').toString('base64'), true)

      expect(audio!.play).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalledWith('play')
    })

    it('should report a play failure and retry without requesting audio again', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]
      const mediaSource = testState.mediaSources[0]
      mockTextToAudioStream.mockResolvedValue(
        makeAudioResponse(200, [{ value: undefined, done: true }]),
      )
      audio!.play.mockRejectedValueOnce(new DOMException('Playback aborted', 'AbortError'))

      mediaSource!.emit('sourceopen')
      player.playAudio()

      await waitFor(() => expect(callback).toHaveBeenCalledWith('error'))
      expect(callback).not.toHaveBeenCalledWith('play')
      expect(player.isLoadData).toBe(true)

      audio!.play.mockImplementationOnce(async () => {
        audio!.paused = false
      })
      player.playAudio()

      await waitFor(() => expect(callback).toHaveBeenCalledWith('play'))

      expect(audio!.play).toHaveBeenCalledTimes(2)
      expect(mockTextToAudioStream).toHaveBeenCalledTimes(1)
    })

    it('should report a resume failure and allow playback to be retried', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]
      const mediaSource = testState.mediaSources[0]
      mockTextToAudioStream.mockResolvedValue(
        makeAudioResponse(200, [{ value: undefined, done: true }]),
      )
      audioContext!.state = 'suspended'
      audioContext!.resume.mockRejectedValueOnce(new DOMException('Not allowed', 'NotAllowedError'))

      mediaSource!.emit('sourceopen')
      player.playAudio()

      await waitFor(() => expect(callback).toHaveBeenCalledWith('error'))
      expect(audio!.play).toHaveBeenCalledTimes(1)
      expect(player.isLoadData).toBe(true)

      audioContext!.resume.mockImplementationOnce(async () => {
        audioContext!.state = 'running'
      })
      player.playAudio()

      await waitFor(() => expect(callback).toHaveBeenCalledWith('play'))

      expect(audioContext!.resume).toHaveBeenCalledTimes(2)
      expect(audio!.play).toHaveBeenCalledTimes(1)
      expect(mockTextToAudioStream).toHaveBeenCalledTimes(1)
    })
  })

  describe('buffering internals', () => {
    it('should finish stream when receiveAudioData gets an undefined chunk', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const finishStream = vi
        .spyOn(player as unknown as { finishStream: () => void }, 'finishStream')
        .mockImplementation(() => {})
      ;(
        player as unknown as { receiveAudioData: (data: Uint8Array | undefined) => void }
      ).receiveAudioData(undefined)

      expect(finishStream).toHaveBeenCalledTimes(1)
    })

    it('should finish stream when receiveAudioData gets empty bytes', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const finishStream = vi
        .spyOn(player as unknown as { finishStream: () => void }, 'finishStream')
        .mockImplementation(() => {})
      ;(player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(
        new Uint8Array(0),
      )

      expect(finishStream).toHaveBeenCalledTimes(1)
    })

    it('should queue incoming buffer when source buffer is updating', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      mediaSource!.emit('sourceopen')
      mediaSource!.sourceBuffer.updating = true
      ;(player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(
        new Uint8Array([1, 2, 3]),
      )

      expect(player.cacheBuffers.length).toBe(1)
    })

    it('should preserve audio received before sourceopen and append it once ready', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]

      ;(player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(
        new Uint8Array([1, 2, 3]),
      )

      expect(player.cacheBuffers).toHaveLength(1)
      expect(mediaSource!.sourceBuffer.appendBuffer).not.toHaveBeenCalled()

      mediaSource!.emit('sourceopen')

      expect(mediaSource!.sourceBuffer.appendBuffer).toHaveBeenCalledTimes(1)
      expect(player.cacheBuffers).toHaveLength(0)
    })

    it('should append queued buffers in order after updateend', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      mediaSource!.emit('sourceopen')
      mediaSource!.sourceBuffer.updating = true

      const first = new Uint8Array([1])
      const second = new Uint8Array([2])
      ;(player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(
        first,
      )
      ;(player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(
        second,
      )

      mediaSource!.sourceBuffer.updating = false
      mediaSource!.sourceBuffer.emit('updateend')
      expect(mediaSource!.sourceBuffer.appendBuffer).toHaveBeenCalledTimes(1)
      expect(new Uint8Array(mediaSource!.sourceBuffer.appendBuffer.mock.calls[0]![0])).toEqual(
        first,
      )

      mediaSource!.sourceBuffer.emit('updateend')
      expect(mediaSource!.sourceBuffer.appendBuffer).toHaveBeenCalledTimes(2)
      expect(new Uint8Array(mediaSource!.sourceBuffer.appendBuffer.mock.calls[1]![0])).toEqual(
        second,
      )
    })

    it('should append previously queued buffer before new one when source buffer is idle', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      mediaSource!.emit('sourceopen')

      const existingBuffer = new ArrayBuffer(2)
      player.cacheBuffers = [existingBuffer]
      mediaSource!.sourceBuffer.updating = false
      ;(player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(
        new Uint8Array([9]),
      )

      expect(mediaSource!.sourceBuffer.appendBuffer).toHaveBeenCalledTimes(1)
      expect(mediaSource!.sourceBuffer.appendBuffer).toHaveBeenCalledWith(existingBuffer)
      expect(player.cacheBuffers.length).toBe(1)
    })

    it('should end the stream only after the final queued buffer is appended', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      mediaSource!.emit('sourceopen')
      mediaSource!.sourceBuffer.updating = true
      player.cacheBuffers = [new ArrayBuffer(3)]

      ;(player as unknown as { finishStream: () => void }).finishStream()

      expect(mediaSource!.endOfStream).not.toHaveBeenCalled()

      mediaSource!.sourceBuffer.updating = false
      mediaSource!.sourceBuffer.emit('updateend')
      expect(mediaSource!.sourceBuffer.appendBuffer).toHaveBeenCalledTimes(1)
      expect(mediaSource!.endOfStream).not.toHaveBeenCalled()

      mediaSource!.sourceBuffer.emit('updateend')
      expect(mediaSource!.endOfStream).toHaveBeenCalledTimes(1)
    })

    it('should end an open stream at most once', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      mediaSource!.emit('sourceopen')

      ;(player as unknown as { finishStream: () => void }).finishStream()
      ;(player as unknown as { finishStream: () => void }).finishStream()

      expect(mediaSource!.endOfStream).toHaveBeenCalledTimes(1)
    })

    it.each(['closed', 'ended'] as const)('should not end a %s media source', (readyState) => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      mediaSource!.emit('sourceopen')
      mediaSource!.readyState = readyState

      ;(player as unknown as { finishStream: () => void }).finishStream()

      expect(mediaSource!.endOfStream).not.toHaveBeenCalled()
    })

    it('should stop buffering and release browser resources after destroy', async () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]
      mediaSource!.emit('sourceopen')

      player.destroy()
      ;(player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(
        new Uint8Array([1]),
      )
      ;(player as unknown as { finishStream: () => void }).finishStream()
      mediaSource!.sourceBuffer.emit('updateend')
      await Promise.resolve()

      expect(mediaSource!.sourceBuffer.appendBuffer).not.toHaveBeenCalled()
      expect(mediaSource!.endOfStream).not.toHaveBeenCalled()
      expect(audio!.pause).toHaveBeenCalledTimes(1)
      expect(audioContext!.close).toHaveBeenCalledTimes(1)
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })
  })
})
