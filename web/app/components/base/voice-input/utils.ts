import lamejs from 'lamejs'
import BitStream from 'lamejs/src/js/BitStream'
import Lame from 'lamejs/src/js/Lame'
import MPEGMode from 'lamejs/src/js/MPEGMode'

if (globalThis) {
  (globalThis as any).MPEGMode = MPEGMode
  ;(globalThis as any).Lame = Lame
  ;(globalThis as any).BitStream = BitStream
}

export const convertToMp3 = (recorder: any) => {
  const wav = lamejs.WavHeader.readHeader(recorder.getWAV())
  const { channels, sampleRate } = wav
  const mp3enc = new lamejs.Mp3Encoder(channels, sampleRate, 128)
  const result = recorder.getChannelData()
  const buffer: BlobPart[] = []

  const leftData = result.left && new Int16Array(result.left.buffer, 0, result.left.byteLength / 2)
  const rightData = result.right && new Int16Array(result.right.buffer, 0, result.right.byteLength / 2)
  const remaining = leftData.length + (rightData ? rightData.length : 0)

  const maxSamples = 1152
  const toArrayBuffer = (bytes: Int8Array) => {
    const arrayBuffer = new ArrayBuffer(bytes.length)
    new Uint8Array(arrayBuffer).set(bytes)
    return arrayBuffer
  }

  for (let i = 0; i < remaining; i += maxSamples) {
    const left = leftData.subarray(i, i + maxSamples)
    let right = null
    let mp3buf = null

    if (channels === 2) {
      right = rightData.subarray(i, i + maxSamples)
      mp3buf = mp3enc.encodeBuffer(left, right)
    }
    else {
      mp3buf = mp3enc.encodeBuffer(left)
    }

    if (mp3buf.length > 0)
      buffer.push(toArrayBuffer(mp3buf))
  }

  const enc = mp3enc.flush()

  if (enc.length > 0)
    buffer.push(toArrayBuffer(enc))

  return new Blob(buffer, { type: 'audio/mp3' })
}
