type RecorderLike = {
  getWAV: () => ArrayBufferLike
  getChannelData: () => {
    left: ArrayBufferView
    right?: ArrayBufferView | null
  }
}

const toInt16Array = (view: ArrayBufferView) => {
  return new Int16Array(view.buffer, view.byteOffset, view.byteLength / 2)
}

const loadLame = async () => {
  const [
    lamejsModule,
    bitStreamModule,
    lameModule,
    mpegModeModule,
  ] = await Promise.all([
    import('lamejs'),
    import('lamejs/src/js/BitStream'),
    import('lamejs/src/js/Lame'),
    import('lamejs/src/js/MPEGMode'),
  ])

  const lamejs = lamejsModule.default
  const BitStream = bitStreamModule.default
  const Lame = lameModule.default
  const MPEGMode = mpegModeModule.default

  /* v8 ignore next - @preserve */
  if (globalThis) {
    ; (globalThis as any).MPEGMode = MPEGMode
    ; (globalThis as any).Lame = Lame
    ; (globalThis as any).BitStream = BitStream
  }

  return lamejs
}

export const convertToMp3 = async (recorder: RecorderLike) => {
  const lamejs = await loadLame()
  const wavBuffer = recorder.getWAV()
  const wavView = wavBuffer instanceof DataView ? wavBuffer : new DataView(wavBuffer)
  const wav = lamejs.WavHeader.readHeader(wavView)
  const { channels, sampleRate } = wav
  const mp3enc = new lamejs.Mp3Encoder(channels, sampleRate, 128)
  const result = recorder.getChannelData()
  const buffer: BlobPart[] = []

  const leftData = toInt16Array(result.left)
  const rightData = result.right ? toInt16Array(result.right) : null
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
      right = rightData?.subarray(i, i + maxSamples) || null
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
