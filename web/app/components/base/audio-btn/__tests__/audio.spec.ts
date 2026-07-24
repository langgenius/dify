import { Buffer } from 'node:buffer'
import { waitFor } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import AudioPlayer from '../audio'

const mockToastNotify = vi.hoisted(() => vi.fn())
const mockTextToAudioStream = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (...args: unknown[]) => mockToastNotify(...args),
  },
}))

vi.mock('@/service/share', () => ({
  AppSourceType: {
    webApp: 'webApp',
    installedApp: 'installedApp',
  },
  textToAudioStream: (...args: unknown[]) => mockTextToAudioStream(...args),
}))

type AudioEventName = 'ended' | 'paused' | 'loaded' | 'play' | 'timeupdate' | 'loadeddate' | 'canplay' | 'error' | 'sourceopen'

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
  appendBuffer = vi.fn((_buffer: ArrayBuffer) => undefined)
  abort = vi.fn(() => undefined)
}

class MockMediaSource {
  readyState: 'open' | 'closed' = 'open'
  sourceBuffer = new MockSourceBuffer()
  private listeners: Partial<Record<AudioEventName, AudioEventListener[]>> = {}

  addEventListener = vi.fn((event: AudioEventName, listener: AudioEventListener) => {
    const listeners = this.listeners[event] || []
    listeners.push(listener)
    this.listeners[event] = listeners
  })

  addSourceBuffer = vi.fn((_contentType: string) => this.sourceBuffer)
  endOfStream = vi.fn(() => undefined)

  emit(event: AudioEventName) {
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
  state: 'running' | 'suspended' = 'running'
  destination = {}
  connect = vi.fn(() => undefined)
  createMediaElementSource = vi.fn((_audio: MockAudio) => ({
    connect: this.connect,
  }))

  resume = vi.fn(async () => {
    this.state = 'running'
  })

  suspend = vi.fn(() => {
    this.state = 'suspended'
  })
}

const testState = {
  mediaSources: [] as MockMediaSource[],
  audios: [] as MockAudio[],
  audioContexts: [] as MockAudioContext[],
}

class MockMediaSourceCtor extends MockMediaSource {
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
const originalMediaSource = window.MediaSource
const originalManagedMediaSource = window.ManagedMediaSource

const setMediaSourceSupport = (options: { mediaSource: boolean, managedMediaSource: boolean }) => {
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
      expect(audio.src).toBe('blob:mock-url')
      expect(audio.autoplay).toBe(true)
      expect(audioContext.createMediaElementSource).toHaveBeenCalledWith(audio)
      expect(audioContext.connect).toHaveBeenCalledTimes(1)
    })

    it('should notify unsupported browser when no MediaSource implementation exists', () => {
      setMediaSourceSupport({ mediaSource: false, managedMediaSource: false })

      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const audio = testState.audios[0]

      expect(player.mediaSource).toBeNull()
      expect(audio.src).toBe('')
      expect(mockToastNotify).toHaveBeenCalledTimes(1)
      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        }),
      )
    })

    it('should configure fallback audio controls when ManagedMediaSource is used', () => {
      setMediaSourceSupport({ mediaSource: false, managedMediaSource: true })

      // Create with callback to ensure constructor path completes with fallback source.
      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, vi.fn())
      const audio = testState.audios[0]

      expect(player.mediaSource).not.toBeNull()
      expect(audio.disableRemotePlayback).toBe(true)
      expect(audio.controls).toBe(true)
    })
  })

  describe('event wiring', () => {
    it('should forward registered audio events to callback', () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]

      audio.emit('play')
      audio.emit('ended')
      audio.emit('error')
      audio.emit('paused')
      audio.emit('loaded')
      audio.emit('timeupdate')
      audio.emit('loadeddate')
      audio.emit('canplay')

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

      mediaSource.emit('sourceopen')
      mediaSource.emit('sourceopen')

      expect(mediaSource.addSourceBuffer).toHaveBeenCalledTimes(1)
      expect(player.sourceBuffer).toBe(mediaSource.sourceBuffer)
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
    })

    it('should resume and play immediately when playAudio is called in suspended loaded state', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]

      player.isLoadData = true
      audioContext.state = 'suspended'
      player.playAudio()
      await Promise.resolve()

      expect(audioContext.resume).toHaveBeenCalledTimes(1)
      expect(audio.play).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('play')
    })

    it('should play ended audio when data is already loaded', () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]

      player.isLoadData = true
      audioContext.state = 'running'
      audio.ended = true
      player.playAudio()

      expect(audio.play).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('play')
    })

    it('should only emit play callback without replaying when loaded audio is already playing', () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', false, 'msg-1', 'hello', undefined, callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]

      player.isLoadData = true
      audioContext.state = 'running'
      audio.ended = false
      player.playAudio()

      expect(audio.play).not.toHaveBeenCalled()
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
      expect(audio.pause).toHaveBeenCalledTimes(1)
      expect(audioContext.suspend).toHaveBeenCalledTimes(1)
    })
  })

  describe('message and direct-audio helpers', () => {
    it('should update message id through resetMsgId', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)

      player.resetMsgId('msg-2')

      expect(player.msgId).toBe('msg-2')
    })

    it('should end stream without playback when playAudioWithAudio receives empty content', async () => {
      vi.useFakeTimers()
      try {
        const callback = vi.fn()
        const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
        const mediaSource = testState.mediaSources[0]

        await player.playAudioWithAudio('', true)
        await vi.advanceTimersByTimeAsync(40)

        expect(player.isLoadData).toBe(false)
        expect(player.cacheBuffers).toHaveLength(0)
        expect(mediaSource.endOfStream).toHaveBeenCalledTimes(1)
        expect(callback).not.toHaveBeenCalledWith('play')
      }
      finally {
        vi.useRealTimers()
      }
    })

    it('should decode base64 and start playback when playAudioWithAudio is called with playable content', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]
      const mediaSource = testState.mediaSources[0]
      const audioBase64 = Buffer.from('hello').toString('base64')

      mediaSource.emit('sourceopen')
      audio.paused = true
      await player.playAudioWithAudio(audioBase64, true)
      await Promise.resolve()

      expect(player.isLoadData).toBe(true)
      expect(player.cacheBuffers).toHaveLength(0)
      expect(mediaSource.sourceBuffer.appendBuffer).toHaveBeenCalledTimes(1)
      const appendedAudioData = mediaSource.sourceBuffer.appendBuffer.mock.calls[0][0]
      expect(appendedAudioData).toBeInstanceOf(ArrayBuffer)
      expect(appendedAudioData.byteLength).toBeGreaterThan(0)
      expect(audioContext.resume).toHaveBeenCalledTimes(1)
      expect(audio.play).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('play')
    })

    it('should skip playback when playAudioWithAudio is called with play=false', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]
      const audioContext = testState.audioContexts[0]

      await player.playAudioWithAudio(Buffer.from('hello').toString('base64'), false)

      expect(player.isLoadData).toBe(false)
      expect(audioContext.resume).not.toHaveBeenCalled()
      expect(audio.play).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalledWith('play')
    })

    it('should play immediately for ended audio in playAudioWithAudio', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]

      audio.paused = false
      audio.ended = true
      await player.playAudioWithAudio(Buffer.from('hello').toString('base64'), true)

      expect(audio.play).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('play')
    })

    it('should not replay when played list exists in playAudioWithAudio', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]

      audio.paused = false
      audio.ended = false
      audio.played = {}
      await player.playAudioWithAudio(Buffer.from('hello').toString('base64'), true)

      expect(audio.play).not.toHaveBeenCalled()
      expect(callback).not.toHaveBeenCalledWith('play')
    })

    it('should replay when paused is false and played list is empty in playAudioWithAudio', async () => {
      const callback = vi.fn()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', callback)
      const audio = testState.audios[0]

      audio.paused = false
      audio.ended = false
      audio.played = null
      await player.playAudioWithAudio(Buffer.from('hello').toString('base64'), true)

      expect(audio.play).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('play')
    })
  })

  describe('buffering internals', () => {
    it('should finish stream when receiveAudioData gets an undefined chunk', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const finishStream = vi
        .spyOn(player as unknown as { finishStream: () => void }, 'finishStream')
        .mockImplementation(() => { })

        ; (player as unknown as { receiveAudioData: (data: Uint8Array | undefined) => void }).receiveAudioData(undefined)

      expect(finishStream).toHaveBeenCalledTimes(1)
    })

    it('should finish stream when receiveAudioData gets empty bytes while source is open', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const finishStream = vi
        .spyOn(player as unknown as { finishStream: () => void }, 'finishStream')
        .mockImplementation(() => { })

        ; (player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(new Uint8Array(0))

      expect(finishStream).toHaveBeenCalledTimes(1)
    })

    it('should queue incoming buffer when source buffer is updating', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      mediaSource.emit('sourceopen')
      mediaSource.sourceBuffer.updating = true

      ; (player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(new Uint8Array([1, 2, 3]))

      expect(player.cacheBuffers.length).toBe(1)
    })

    it('should append previously queued buffer before new one when source buffer is idle', () => {
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      mediaSource.emit('sourceopen')

      const existingBuffer = new ArrayBuffer(2)
      player.cacheBuffers = [existingBuffer]
      mediaSource.sourceBuffer.updating = false

      ; (player as unknown as { receiveAudioData: (data: Uint8Array) => void }).receiveAudioData(new Uint8Array([9]))

      expect(mediaSource.sourceBuffer.appendBuffer).toHaveBeenCalledTimes(1)
      expect(mediaSource.sourceBuffer.appendBuffer).toHaveBeenCalledWith(existingBuffer)
      expect(player.cacheBuffers.length).toBe(1)
    })

    it('should append cache chunks and end stream when finishStream drains buffers', () => {
      vi.useFakeTimers()
      const player = new AudioPlayer('/text-to-audio', true, 'msg-1', 'hello', 'en-US', null)
      const mediaSource = testState.mediaSources[0]
      mediaSource.emit('sourceopen')
      mediaSource.sourceBuffer.updating = false
      player.cacheBuffers = [new ArrayBuffer(3)]

      ; (player as unknown as { finishStream: () => void }).finishStream()
      vi.advanceTimersByTime(50)

      expect(mediaSource.sourceBuffer.appendBuffer).toHaveBeenCalledTimes(1)
      expect(mediaSource.endOfStream).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })
  })
})
