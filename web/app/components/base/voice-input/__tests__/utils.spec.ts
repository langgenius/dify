import { convertToMp3 } from '../utils'

const mocks = vi.hoisted(() => {
  const state = {
    targets: [] as Array<{ buffer: ArrayBuffer | null }>,
    outputs: [] as Array<{
      format: unknown
      target: { buffer: ArrayBuffer | null }
      addAudioTrack: ReturnType<typeof vi.fn>
      start: ReturnType<typeof vi.fn>
      finalize: ReturnType<typeof vi.fn>
    }>,
    sources: [] as Array<{
      encodingConfig: unknown
      add: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    }>,
    samples: [] as Array<{
      init: {
        data: Int16Array
        format: string
        numberOfChannels: number
        sampleRate: number
        timestamp: number
      }
      close: ReturnType<typeof vi.fn>
    }>,
    formats: [] as unknown[],
    outputBuffer: new Uint8Array([1, 2, 3, 4, 5]).buffer as ArrayBuffer | null,
  }

  const registerMp3Encoder = vi.fn()
  const canEncodeAudio = vi.fn()

  class MockBufferTarget {
    buffer: ArrayBuffer | null = state.outputBuffer

    constructor() {
      state.targets.push(this)
    }
  }

  class MockMp3OutputFormat {
    constructor() {
      state.formats.push(this)
    }
  }

  class MockOutput {
    format: unknown
    target: { buffer: ArrayBuffer | null }
    addAudioTrack = vi.fn()
    start = vi.fn(async () => {})
    finalize = vi.fn(async () => {})

    constructor(options: { format: unknown, target: { buffer: ArrayBuffer | null } }) {
      this.format = options.format
      this.target = options.target
      state.outputs.push(this)
    }
  }

  class MockAudioSampleSource {
    encodingConfig: unknown
    add = vi.fn(async () => {})
    close = vi.fn()

    constructor(encodingConfig: unknown) {
      this.encodingConfig = encodingConfig
      state.sources.push(this)
    }
  }

  class MockAudioSample {
    init: {
      data: Int16Array
      format: string
      numberOfChannels: number
      sampleRate: number
      timestamp: number
    }

    close = vi.fn()

    constructor(init: MockAudioSample['init']) {
      this.init = init
      state.samples.push(this)
    }
  }

  return {
    state,
    registerMp3Encoder,
    canEncodeAudio,
    MockAudioSample,
    MockAudioSampleSource,
    MockBufferTarget,
    MockMp3OutputFormat,
    MockOutput,
  }
})

vi.mock('@mediabunny/mp3-encoder', () => ({
  registerMp3Encoder: mocks.registerMp3Encoder,
}))

vi.mock('mediabunny', () => ({
  AudioSample: mocks.MockAudioSample,
  AudioSampleSource: mocks.MockAudioSampleSource,
  BufferTarget: mocks.MockBufferTarget,
  Mp3OutputFormat: mocks.MockMp3OutputFormat,
  Output: mocks.MockOutput,
  canEncodeAudio: mocks.canEncodeAudio,
}))

function createWavHeader(channels: number, sampleRate: number) {
  const view = new DataView(new ArrayBuffer(44))

  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)

  return view
}

function createPcmDataView(samples: number[]) {
  const view = new DataView(new ArrayBuffer(samples.length * 2))

  samples.forEach((sample, index) => {
    view.setInt16(index * 2, sample, true)
  })

  return view
}

function createMockRecorder(opts: {
  channels: number
  sampleRate: number
  leftSamples: number[]
  rightSamples?: number[]
}) {
  return {
    getWAV: vi.fn(() => createWavHeader(opts.channels, opts.sampleRate)),
    getChannelData: vi.fn(() => ({
      left: createPcmDataView(opts.leftSamples),
      right: opts.rightSamples ? createPcmDataView(opts.rightSamples) : null,
    })),
  }
}

async function expectBlobBytes(blob: Blob, bytes: number[]) {
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(bytes))
}

function getOnly<T>(items: T[]) {
  expect(items).toHaveLength(1)
  return items[0]!
}

describe('convertToMp3', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.targets = []
    mocks.state.outputs = []
    mocks.state.sources = []
    mocks.state.samples = []
    mocks.state.formats = []
    mocks.state.outputBuffer = new Uint8Array([1, 2, 3, 4, 5]).buffer
    mocks.canEncodeAudio.mockResolvedValue(false)
  })

  it('should encode mono recorder PCM data with Mediabunny', async () => {
    const recorder = createMockRecorder({
      channels: 1,
      sampleRate: 16000,
      leftSamples: [-32768, 0, 32767],
    })

    const result = await convertToMp3(recorder)
    const output = getOnly(mocks.state.outputs)
    const source = getOnly(mocks.state.sources)
    const sample = getOnly(mocks.state.samples)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/mp3')
    expect(mocks.canEncodeAudio).toHaveBeenCalledWith('mp3')
    expect(mocks.registerMp3Encoder).toHaveBeenCalled()
    expect(source.encodingConfig).toEqual({
      codec: 'mp3',
      bitrate: 128000,
    })
    expect(sample.init).toMatchObject({
      format: 's16',
      numberOfChannels: 1,
      sampleRate: 16000,
      timestamp: 0,
    })
    expect(Array.from(sample.init.data)).toEqual([-32768, 0, 32767])
    expect(output.addAudioTrack).toHaveBeenCalledWith(source)
    expect(output.start).toHaveBeenCalled()
    expect(source.add).toHaveBeenCalledWith(sample)
    expect(sample.close).toHaveBeenCalled()
    expect(source.close).toHaveBeenCalled()
    expect(output.finalize).toHaveBeenCalled()
    await expectBlobBytes(result, [1, 2, 3, 4, 5])
  })

  it('should encode stereo recorder PCM data as interleaved samples', async () => {
    const recorder = createMockRecorder({
      channels: 2,
      sampleRate: 48000,
      leftSamples: [100, -100],
      rightSamples: [300, -300],
    })

    const result = await convertToMp3(recorder)
    const sample = getOnly(mocks.state.samples)

    expect(sample.init).toMatchObject({
      format: 's16',
      numberOfChannels: 2,
      sampleRate: 48000,
      timestamp: 0,
    })
    expect(Array.from(sample.init.data)).toEqual([100, 300, -100, -300])
    await expectBlobBytes(result, [1, 2, 3, 4, 5])
  })

  it('should skip custom encoder registration when native MP3 encoding is available', async () => {
    mocks.canEncodeAudio.mockResolvedValue(true)
    const recorder = createMockRecorder({
      channels: 1,
      sampleRate: 44100,
      leftSamples: [100],
    })

    await convertToMp3(recorder)

    expect(mocks.registerMp3Encoder).not.toHaveBeenCalled()
  })

  it('should return an empty MP3 blob when the target has no buffer', async () => {
    mocks.state.outputBuffer = null
    const recorder = createMockRecorder({
      channels: 1,
      sampleRate: 22050,
      leftSamples: [1],
    })

    const result = await convertToMp3(recorder)

    expect(result.size).toBe(0)
  })

  it('should reject unsupported WAV channel counts', async () => {
    const recorder = createMockRecorder({
      channels: 3,
      sampleRate: 44100,
      leftSamples: [100],
    })

    await expect(convertToMp3(recorder)).rejects.toThrow('Unsupported WAV channel count: 3')
    expect(mocks.canEncodeAudio).not.toHaveBeenCalled()
  })

  it('should reject stereo WAV data without a right channel', async () => {
    const recorder = createMockRecorder({
      channels: 2,
      sampleRate: 44100,
      leftSamples: [100],
    })

    await expect(convertToMp3(recorder)).rejects.toThrow('Missing right channel data for stereo WAV')
  })

  it('should reject stereo WAV data with mismatched channel lengths', async () => {
    const recorder = createMockRecorder({
      channels: 2,
      sampleRate: 44100,
      leftSamples: [100, 200],
      rightSamples: [300],
    })

    await expect(convertToMp3(recorder)).rejects.toThrow('Stereo WAV channel sample counts do not match')
  })
})
