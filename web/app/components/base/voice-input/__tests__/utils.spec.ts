import { convertToMp3 } from '../utils'

// ── Hoisted mocks ──

const mocks = vi.hoisted(() => {
  const readHeader = vi.fn()
  const encodeBuffer = vi.fn()
  const flush = vi.fn()

  return { readHeader, encodeBuffer, flush }
})

vi.mock('lamejs', () => ({
  default: {
    WavHeader: {
      readHeader: mocks.readHeader,
    },
    Mp3Encoder: class MockMp3Encoder {
      encodeBuffer = mocks.encodeBuffer
      flush = mocks.flush
    },
  },
}))

vi.mock('lamejs/src/js/BitStream', () => ({ default: {} }))
vi.mock('lamejs/src/js/Lame', () => ({ default: {} }))
vi.mock('lamejs/src/js/MPEGMode', () => ({ default: {} }))

// ── helpers ──

/** Build a fake recorder whose getChannelData returns DataView-like objects with .buffer and .byteLength. */
function createMockRecorder(opts: {
  channels: number
  sampleRate: number
  leftSamples: number[]
  rightSamples?: number[]
}) {
  const toDataView = (samples: number[]) => {
    const buf = new ArrayBuffer(samples.length * 2)
    const view = new DataView(buf)
    samples.forEach((v, i) => {
      view.setInt16(i * 2, v, true)
    })
    return view
  }

  const leftView = toDataView(opts.leftSamples)
  const rightView = opts.rightSamples ? toDataView(opts.rightSamples) : null

  mocks.readHeader.mockReturnValue({
    channels: opts.channels,
    sampleRate: opts.sampleRate,
  })

  return {
    getWAV: vi.fn(() => new ArrayBuffer(44)),
    getChannelData: vi.fn(() => ({
      left: leftView,
      right: rightView,
    })),
  }
}

describe('convertToMp3', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should convert mono WAV data to an MP3 blob', () => {
    const recorder = createMockRecorder({
      channels: 1,
      sampleRate: 44100,
      leftSamples: [100, 200, 300, 400],
    })

    mocks.encodeBuffer.mockReturnValue(new Int8Array([1, 2, 3]))
    mocks.flush.mockReturnValue(new Int8Array([4, 5]))

    const result = convertToMp3(recorder)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/mp3')
    expect(mocks.encodeBuffer).toHaveBeenCalled()
    // Mono: encodeBuffer called with only left data
    const firstCall = mocks.encodeBuffer.mock.calls[0]
    expect(firstCall).toHaveLength(1)
    expect(mocks.flush).toHaveBeenCalled()
  })

  it('should convert stereo WAV data to an MP3 blob', () => {
    const recorder = createMockRecorder({
      channels: 2,
      sampleRate: 48000,
      leftSamples: [100, 200],
      rightSamples: [300, 400],
    })

    mocks.encodeBuffer.mockReturnValue(new Int8Array([10, 20]))
    mocks.flush.mockReturnValue(new Int8Array([30]))

    const result = convertToMp3(recorder)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/mp3')
    // Stereo: encodeBuffer called with left AND right
    const firstCall = mocks.encodeBuffer.mock.calls[0]
    expect(firstCall).toHaveLength(2)
  })

  it('should skip empty encoded buffers', () => {
    const recorder = createMockRecorder({
      channels: 1,
      sampleRate: 44100,
      leftSamples: [100, 200],
    })

    mocks.encodeBuffer.mockReturnValue(new Int8Array(0))
    mocks.flush.mockReturnValue(new Int8Array(0))

    const result = convertToMp3(recorder)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/mp3')
    expect(result.size).toBe(0)
  })

  it('should include flush data when flush returns non-empty buffer', () => {
    const recorder = createMockRecorder({
      channels: 1,
      sampleRate: 22050,
      leftSamples: [1],
    })

    mocks.encodeBuffer.mockReturnValue(new Int8Array(0))
    mocks.flush.mockReturnValue(new Int8Array([99, 98, 97]))

    const result = convertToMp3(recorder)

    expect(result).toBeInstanceOf(Blob)
    expect(result.size).toBe(3)
  })

  it('should omit flush data when flush returns empty buffer', () => {
    const recorder = createMockRecorder({
      channels: 1,
      sampleRate: 44100,
      leftSamples: [10, 20],
    })

    mocks.encodeBuffer.mockReturnValue(new Int8Array([1, 2]))
    mocks.flush.mockReturnValue(new Int8Array(0))

    const result = convertToMp3(recorder)

    expect(result).toBeInstanceOf(Blob)
    expect(result.size).toBe(2)
  })

  it('should process multiple chunks when sample count exceeds maxSamples (1152)', () => {
    const samples = Array.from({ length: 2400 }, (_, i) => i % 32767)
    const recorder = createMockRecorder({
      channels: 1,
      sampleRate: 44100,
      leftSamples: samples,
    })

    mocks.encodeBuffer.mockReturnValue(new Int8Array([1]))
    mocks.flush.mockReturnValue(new Int8Array(0))

    const result = convertToMp3(recorder)

    expect(mocks.encodeBuffer.mock.calls.length).toBeGreaterThan(1)
    expect(result).toBeInstanceOf(Blob)
  })

  it('should encode stereo with right channel subarray', () => {
    const recorder = createMockRecorder({
      channels: 2,
      sampleRate: 44100,
      leftSamples: [100, 200, 300],
      rightSamples: [400, 500, 600],
    })

    mocks.encodeBuffer.mockReturnValue(new Int8Array([5, 6, 7]))
    mocks.flush.mockReturnValue(new Int8Array([8]))

    const result = convertToMp3(recorder)

    expect(result).toBeInstanceOf(Blob)
    for (const call of mocks.encodeBuffer.mock.calls) {
      expect(call).toHaveLength(2)
      expect(call[0]).toBeInstanceOf(Int16Array)
      expect(call[1]).toBeInstanceOf(Int16Array)
    }
  })
})
