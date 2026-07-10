import { startVoiceRecorder } from '../recorder'

const mediaMocks = vi.hoisted(() => ({
  audioSourceAdd: vi.fn<(buffer: AudioBuffer) => Promise<void>>(),
  audioSourceConfig: undefined as unknown,
  outputCancel: vi.fn<() => Promise<void>>(),
  outputFinalize: vi.fn<() => Promise<void>>(),
  outputStart: vi.fn<() => Promise<void>>(),
  registerMp3Encoder: vi.fn(),
  target: undefined as { buffer: ArrayBuffer | null } | undefined,
}))

vi.mock('@mediabunny/mp3-encoder', () => ({
  registerMp3Encoder: mediaMocks.registerMp3Encoder,
}))

vi.mock('mediabunny', () => ({
  AudioBufferSource: class MockAudioBufferSource {
    constructor(config: unknown) {
      mediaMocks.audioSourceConfig = config
    }

    add(buffer: AudioBuffer) {
      return mediaMocks.audioSourceAdd(buffer)
    }
  },
  BufferTarget: class MockBufferTarget {
    buffer: ArrayBuffer | null = null

    constructor() {
      mediaMocks.target = this
    }
  },
  Mp3OutputFormat: class MockMp3OutputFormat {},
  Output: class MockOutput {
    addAudioTrack = vi.fn()

    start() {
      return mediaMocks.outputStart()
    }

    finalize() {
      return mediaMocks.outputFinalize()
    }

    cancel() {
      return mediaMocks.outputCancel()
    }
  },
}))

const trackStop = vi.fn()
const stream = {
  getAudioTracks: vi.fn(() => [{ stop: trackStop }]),
  getTracks: vi.fn(() => [{ stop: trackStop }]),
} as unknown as MediaStream
const getUserMedia = vi.fn<() => Promise<MediaStream>>()
const addModule = vi.fn<() => Promise<void>>()
const audioContextClose = vi.fn<() => Promise<void>>()
const audioContextResume = vi.fn<() => Promise<void>>()
const analyserDisconnect = vi.fn()
const analyser = {
  disconnect: analyserDisconnect,
  fftSize: 0,
} as unknown as AnalyserNode
const streamSourceConnect = vi.fn()
const streamSourceDisconnect = vi.fn()
const streamSource = {
  connect: streamSourceConnect,
  disconnect: streamSourceDisconnect,
} as unknown as MediaStreamAudioSourceNode
const copyToChannel = vi.fn()
let audioContextState: AudioContextState = 'running'

class MockAudioContext {
  audioWorklet = { addModule }
  destination = {}
  sampleRate = 48_000

  get state() {
    return audioContextState
  }

  createAnalyser() {
    return analyser
  }

  createMediaStreamSource() {
    return streamSource
  }

  createBuffer() {
    return { copyToChannel } as unknown as AudioBuffer
  }

  close() {
    return audioContextClose()
  }

  resume() {
    audioContextState = 'running'
    return audioContextResume()
  }
}

const workletConnect = vi.fn()
const workletDisconnect = vi.fn()
let workletRespondsToStop = true

class MockAudioWorkletNode {
  port: {
    onmessage: ((event: MessageEvent<{ type: 'data', buffer: ArrayBuffer } | { type: 'stopped' }>) => void) | null
    postMessage: (message: { type: string }) => void
  }

  constructor() {
    this.port = {
      onmessage: null,
      postMessage: vi.fn((message: { type: string }) => {
        if (message.type !== 'stop' || !workletRespondsToStop)
          return
        this.port.onmessage?.({
          data: { type: 'data', buffer: new Float32Array([0.25, -0.25]).buffer },
        } as MessageEvent<{ type: 'data', buffer: ArrayBuffer }>)
        this.port.onmessage?.({ data: { type: 'stopped' } } as MessageEvent<{ type: 'stopped' }>)
      }),
    }
  }

  connect = workletConnect
  disconnect = workletDisconnect
}

describe('startVoiceRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mediaMocks.target = undefined
    mediaMocks.audioSourceConfig = undefined
    getUserMedia.mockResolvedValue(stream)
    addModule.mockResolvedValue()
    audioContextClose.mockResolvedValue()
    audioContextResume.mockResolvedValue()
    mediaMocks.audioSourceAdd.mockResolvedValue()
    mediaMocks.outputCancel.mockResolvedValue()
    mediaMocks.outputStart.mockResolvedValue()
    mediaMocks.outputFinalize.mockImplementation(async () => {
      if (mediaMocks.target)
        mediaMocks.target.buffer = new Uint8Array([1, 2, 3]).buffer
    })
    workletRespondsToStop = true
    audioContextState = 'running'
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice-worklet')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  // Recording setup uses one browser-native PCM path and one MP3 encoder configuration.
  describe('Setup', () => {
    it('should initialize mono microphone capture and the MP3 encoder', async () => {
      await startVoiceRecorder()

      expect(getUserMedia).toHaveBeenCalledWith({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      expect(mediaMocks.registerMp3Encoder).toHaveBeenCalledTimes(1)
      expect(mediaMocks.audioSourceConfig).toEqual({
        bitrate: 128_000,
        codec: 'mp3',
        transform: {
          numberOfChannels: 1,
          sampleRate: 16_000,
        },
      })
      expect(addModule).toHaveBeenCalledWith('blob:voice-worklet')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-worklet')
    })

    it('should resume a suspended audio context before recording', async () => {
      audioContextState = 'suspended'

      await startVoiceRecorder()

      expect(audioContextResume).toHaveBeenCalledTimes(1)
    })

    it('should release a microphone stream that resolves after setup is cancelled', async () => {
      let resolveStream: (stream: MediaStream) => void = () => {}
      getUserMedia.mockReturnValueOnce(new Promise((resolve) => {
        resolveStream = resolve
      }))
      const abortController = new AbortController()
      const recorderPromise = startVoiceRecorder(abortController.signal)
      await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))

      abortController.abort()
      resolveStream(stream)

      await expect(recorderPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(trackStop).toHaveBeenCalledTimes(1)
      expect(addModule).not.toHaveBeenCalled()
    })

    it('should abort and clean up while the worklet module is still loading', async () => {
      addModule.mockReturnValueOnce(new Promise(() => {}))
      const abortController = new AbortController()
      const recorderPromise = startVoiceRecorder(abortController.signal)
      await vi.waitFor(() => expect(addModule).toHaveBeenCalledTimes(1))

      abortController.abort()

      await expect(recorderPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(trackStop).toHaveBeenCalledTimes(1)
      expect(audioContextClose).toHaveBeenCalledTimes(1)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-worklet')
    })

    it('should abort and clean up while the encoder is still starting', async () => {
      mediaMocks.outputStart.mockReturnValueOnce(new Promise(() => {}))
      const abortController = new AbortController()
      const recorderPromise = startVoiceRecorder(abortController.signal)
      await vi.waitFor(() => expect(mediaMocks.outputStart).toHaveBeenCalledTimes(1))

      abortController.abort()

      await expect(recorderPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(trackStop).toHaveBeenCalledTimes(1)
      expect(audioContextClose).toHaveBeenCalledTimes(1)
      expect(mediaMocks.outputCancel).toHaveBeenCalledTimes(1)
    })

    it('should abort and clean up while the audio context is still resuming', async () => {
      audioContextState = 'suspended'
      audioContextResume.mockReturnValueOnce(new Promise(() => {}))
      const abortController = new AbortController()
      const recorderPromise = startVoiceRecorder(abortController.signal)
      await vi.waitFor(() => expect(audioContextResume).toHaveBeenCalledTimes(1))

      abortController.abort()

      await expect(recorderPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(trackStop).toHaveBeenCalledTimes(1)
      expect(audioContextClose).toHaveBeenCalledTimes(1)
      expect(mediaMocks.outputCancel).toHaveBeenCalledTimes(1)
    })
  })

  // Stopping flushes queued PCM before exposing the final MP3 blob.
  describe('Stop', () => {
    it('should encode queued PCM and release microphone resources', async () => {
      const recorder = await startVoiceRecorder()

      const result = await recorder.stop()

      expect(copyToChannel).toHaveBeenCalledTimes(1)
      expect(mediaMocks.audioSourceAdd).toHaveBeenCalledTimes(1)
      expect(mediaMocks.outputFinalize).toHaveBeenCalledTimes(1)
      expect(result.type).toBe('audio/mp3')
      expect(result.size).toBe(3)
      expect(trackStop).toHaveBeenCalled()
      expect(audioContextClose).toHaveBeenCalledTimes(1)
    })

    it('should release microphone resources before MP3 finalization completes', async () => {
      let resolveFinalize: () => void = () => {}
      mediaMocks.outputFinalize.mockReturnValueOnce(new Promise((resolve) => {
        resolveFinalize = () => {
          if (mediaMocks.target)
            mediaMocks.target.buffer = new Uint8Array([1, 2, 3]).buffer
          resolve()
        }
      }))
      const recorder = await startVoiceRecorder()

      const stopPromise = recorder.stop()
      await vi.waitFor(() => expect(mediaMocks.outputFinalize).toHaveBeenCalledTimes(1))
      const trackStopCallsBeforeFinalize = trackStop.mock.calls.length
      const audioContextCloseCallsBeforeFinalize = audioContextClose.mock.calls.length
      resolveFinalize()
      await stopPromise

      expect(trackStopCallsBeforeFinalize).toBe(1)
      expect(audioContextCloseCallsBeforeFinalize).toBe(1)
    })

    it('should reuse the in-flight stop operation', async () => {
      const recorder = await startVoiceRecorder()

      const firstStop = recorder.stop()
      const secondStop = recorder.stop()

      await expect(secondStop).resolves.toBe(await firstStop)
      expect(mediaMocks.outputFinalize).toHaveBeenCalledTimes(1)
    })

    it('should reject when the encoder produces no MP3 bytes', async () => {
      mediaMocks.outputFinalize.mockResolvedValueOnce()
      const recorder = await startVoiceRecorder()

      await expect(recorder.stop()).rejects.toThrow('produced no audio data')
    })

    it('should cancel output when queued PCM encoding fails', async () => {
      mediaMocks.audioSourceAdd.mockRejectedValueOnce(new Error('encode failed'))
      const recorder = await startVoiceRecorder()

      await expect(recorder.stop()).rejects.toThrow('encode failed')
      expect(mediaMocks.outputCancel).toHaveBeenCalledTimes(1)
    })
  })

  // Cancellation and setup failures must release the microphone without uploading data.
  describe('Cleanup', () => {
    it('should cancel encoding and release resources', async () => {
      const recorder = await startVoiceRecorder()

      await recorder.cancel()

      expect(mediaMocks.outputCancel).toHaveBeenCalledTimes(1)
      expect(trackStop).toHaveBeenCalled()
      expect(audioContextClose).toHaveBeenCalledTimes(1)
    })

    it('should release the stream when no audio track is available', async () => {
      const emptyStream = {
        getAudioTracks: () => [],
        getTracks: () => [{ stop: trackStop }],
      } as unknown as MediaStream
      getUserMedia.mockResolvedValueOnce(emptyStream)

      await expect(startVoiceRecorder()).rejects.toThrow('No audio track')
      expect(trackStop).toHaveBeenCalledTimes(1)
    })

    it('should cancel partial output when encoder startup fails', async () => {
      mediaMocks.outputStart.mockRejectedValueOnce(new Error('encoder unavailable'))

      await expect(startVoiceRecorder()).rejects.toThrow('encoder unavailable')
      expect(mediaMocks.outputCancel).toHaveBeenCalledTimes(1)
      expect(trackStop).toHaveBeenCalled()
      expect(audioContextClose).toHaveBeenCalledTimes(1)
    })

    it('should release the microphone before canceling a failed encoder setup', async () => {
      mediaMocks.outputStart.mockRejectedValueOnce(new Error('encoder unavailable'))
      mediaMocks.outputCancel.mockRejectedValueOnce(new Error('encoder cleanup failed'))

      await expect(startVoiceRecorder()).rejects.toThrow()

      expect(trackStop).toHaveBeenCalledTimes(1)
      expect(audioContextClose).toHaveBeenCalledTimes(1)
    })

    it('should release capture while an in-flight stop finishes encoding', async () => {
      let resolveFinalize: () => void = () => {}
      mediaMocks.outputFinalize.mockReturnValueOnce(new Promise((resolve) => {
        resolveFinalize = () => {
          if (mediaMocks.target)
            mediaMocks.target.buffer = new Uint8Array([1, 2, 3]).buffer
          resolve()
        }
      }))
      const recorder = await startVoiceRecorder()
      const stopPromise = recorder.stop()
      await vi.waitFor(() => expect(mediaMocks.outputFinalize).toHaveBeenCalledTimes(1))

      const cancelPromise = recorder.cancel()
      await vi.waitFor(() => expect(trackStop).toHaveBeenCalledTimes(1))
      resolveFinalize()

      await cancelPromise
      await expect(stopPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(mediaMocks.outputCancel).toHaveBeenCalledTimes(1)
    })

    it('should cancel capture when the worklet stop acknowledgement is pending', async () => {
      workletRespondsToStop = false
      const recorder = await startVoiceRecorder()
      const stopPromise = recorder.stop()

      await recorder.cancel()

      await expect(stopPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(trackStop).toHaveBeenCalledTimes(1)
      expect(audioContextClose).toHaveBeenCalledTimes(1)
      expect(mediaMocks.outputCancel).toHaveBeenCalledTimes(1)
    })

    it('should complete runtime cleanup when a node disconnect fails', async () => {
      streamSourceDisconnect.mockImplementationOnce(() => {
        throw new Error('disconnect failed')
      })
      const recorder = await startVoiceRecorder()

      await expect(recorder.cancel()).resolves.toBeUndefined()

      expect(trackStop).toHaveBeenCalledTimes(1)
      expect(analyserDisconnect).toHaveBeenCalledTimes(1)
      expect(workletDisconnect).toHaveBeenCalledTimes(1)
      expect(audioContextClose).toHaveBeenCalledTimes(1)
      expect(mediaMocks.outputCancel).toHaveBeenCalledTimes(1)
    })

    it('should resolve cancellation when encoder cleanup fails', async () => {
      mediaMocks.outputCancel.mockRejectedValueOnce(new Error('encoder cleanup failed'))
      const recorder = await startVoiceRecorder()

      await expect(recorder.cancel()).resolves.toBeUndefined()

      expect(trackStop).toHaveBeenCalledTimes(1)
      expect(audioContextClose).toHaveBeenCalledTimes(1)
    })

    it('should not open the microphone when the encoder module fails to load', async () => {
      vi.resetModules()
      vi.doMock('../mp3-encoder', () => {
        throw new Error('encoder chunk unavailable')
      })

      try {
        const { startVoiceRecorder: startWithUnavailableEncoder } = await import('../recorder')

        await expect(startWithUnavailableEncoder()).rejects.toThrow()
        expect(getUserMedia).not.toHaveBeenCalled()
      }
      finally {
        vi.doUnmock('../mp3-encoder')
      }
    })
  })
})
