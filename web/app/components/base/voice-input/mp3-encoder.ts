import { registerMp3Encoder } from '@mediabunny/mp3-encoder'
import { AudioBufferSource, BufferTarget, Mp3OutputFormat, Output } from 'mediabunny'

const AUDIO_BITRATE = 128_000
const AUDIO_SAMPLE_RATE = 16_000

export function createMp3Encoder() {
  registerMp3Encoder()

  const target = new BufferTarget()
  const output = new Output({
    format: new Mp3OutputFormat(),
    target,
  })
  const audioSource = new AudioBufferSource({
    bitrate: AUDIO_BITRATE,
    codec: 'mp3',
    transform: {
      numberOfChannels: 1,
      sampleRate: AUDIO_SAMPLE_RATE,
    },
  })
  output.addAudioTrack(audioSource)

  return { audioSource, output, target }
}
