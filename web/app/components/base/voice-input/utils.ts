import { registerMp3Encoder } from '@mediabunny/mp3-encoder'
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  canEncodeAudio,
  Mp3OutputFormat,
  Output,
} from 'mediabunny'

type SupportedChannelCount = 1 | 2

type RecorderChannelData = {
  left: DataView
  right?: DataView | null
}

export type AudioRecorder = {
  getWAV: () => ArrayBuffer | DataView
  getChannelData: () => RecorderChannelData
}

const wavChannelsOffset = 22
const wavSampleRateOffset = 24
const bytesPerSample = 2
const mp3Bitrate = 128_000

const ensureMp3Encoder = async () => {
  if (!(await canEncodeAudio('mp3')))
    registerMp3Encoder()
}

const readWavInfo = (wav: ArrayBuffer | DataView) => {
  const view = wav instanceof DataView ? wav : new DataView(wav)
  const channels = view.getUint16(wavChannelsOffset, true)

  if (channels !== 1 && channels !== 2)
    throw new Error(`Unsupported WAV channel count: ${channels}`)

  return {
    channels: channels as SupportedChannelCount,
    sampleRate: view.getUint32(wavSampleRateOffset, true),
  }
}

const readInt16Samples = (data: DataView) => {
  const samples = new Int16Array(data.byteLength / bytesPerSample)

  for (let i = 0; i < samples.length; i++)
    samples[i] = data.getInt16(i * bytesPerSample, true)

  return samples
}

const createPcmData = (data: RecorderChannelData, channels: SupportedChannelCount) => {
  const leftSamples = readInt16Samples(data.left)

  if (channels === 1)
    return leftSamples

  if (!data.right)
    throw new Error('Missing right channel data for stereo WAV')

  const rightSamples = readInt16Samples(data.right)

  if (leftSamples.length !== rightSamples.length)
    throw new Error('Stereo WAV channel sample counts do not match')

  const samples = new Int16Array(leftSamples.length * channels)

  for (let i = 0; i < leftSamples.length; i++) {
    samples[i * channels] = leftSamples[i]!
    samples[i * channels + 1] = rightSamples[i]!
  }

  return samples
}

export const convertToMp3 = async (recorder: AudioRecorder) => {
  const { channels, sampleRate } = readWavInfo(recorder.getWAV())
  const result = recorder.getChannelData()
  const pcmData = createPcmData(result, channels)

  await ensureMp3Encoder()

  const target = new BufferTarget()
  const output = new Output({
    format: new Mp3OutputFormat(),
    target,
  })
  const source = new AudioSampleSource({
    codec: 'mp3',
    bitrate: mp3Bitrate,
  })
  const sample = new AudioSample({
    data: pcmData,
    format: 's16',
    numberOfChannels: channels,
    sampleRate,
    timestamp: 0,
  })

  output.addAudioTrack(source)
  await output.start()
  await source.add(sample)
  sample.close()
  source.close()
  await output.finalize()

  return new Blob([target.buffer ?? new ArrayBuffer(0)], { type: 'audio/mp3' })
}
