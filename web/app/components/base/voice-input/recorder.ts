const AUDIO_MIME_TYPE = 'audio/mp3'
const AUDIO_WORKLET_NAME = 'voice-input-recorder'
const AUDIO_WORKLET_BUFFER_SIZE = 4096

const AUDIO_WORKLET_SOURCE = `
class VoiceInputRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(${AUDIO_WORKLET_BUFFER_SIZE})
    this.offset = 0
    this.stopped = false
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'stop')
        return
      this.flush()
      this.stopped = true
      this.port.postMessage({ type: 'stopped' })
    }
  }

  flush() {
    if (!this.offset)
      return
    const buffer = this.buffer.slice(0, this.offset)
    this.port.postMessage({ type: 'data', buffer: buffer.buffer }, [buffer.buffer])
    this.buffer = new Float32Array(${AUDIO_WORKLET_BUFFER_SIZE})
    this.offset = 0
  }

  process(inputs) {
    if (this.stopped)
      return false
    const channel = inputs[0]?.[0]
    if (!channel)
      return true

    let sourceOffset = 0
    while (sourceOffset < channel.length) {
      const copyLength = Math.min(channel.length - sourceOffset, this.buffer.length - this.offset)
      this.buffer.set(channel.subarray(sourceOffset, sourceOffset + copyLength), this.offset)
      this.offset += copyLength
      sourceOffset += copyLength
      if (this.offset === this.buffer.length)
        this.flush()
    }
    return true
  }
}

registerProcessor('${AUDIO_WORKLET_NAME}', VoiceInputRecorderProcessor)
`

export type VoiceRecorder = {
  analyser: AnalyserNode
  stop: () => Promise<Blob>
  cancel: () => Promise<void>
}

export async function startVoiceRecorder(): Promise<VoiceRecorder> {
  let stream: MediaStream | undefined
  let audioContext: AudioContext | undefined
  let output: Awaited<ReturnType<typeof import('./mp3-encoder').createMp3Encoder>>['output'] | undefined

  try {
    const [mediaStream, { createMp3Encoder }] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      }),
      import('./mp3-encoder'),
    ])
    stream = mediaStream

    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack)
      throw new Error('No audio track is available.')

    audioContext = new AudioContext()
    const workletUrl = URL.createObjectURL(new Blob([AUDIO_WORKLET_SOURCE], { type: 'application/javascript' }))
    try {
      await audioContext.audioWorklet.addModule(workletUrl)
    }
    finally {
      URL.revokeObjectURL(workletUrl)
    }

    const encoder = createMp3Encoder()
    const { audioSource, target } = encoder
    output = encoder.output
    await output.start()

    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    const streamSource = audioContext.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(audioContext, AUDIO_WORKLET_NAME)
    let resolveWorkletStopped: () => void = () => {}
    const workletStopped = new Promise<void>((resolve) => {
      resolveWorkletStopped = resolve
    })
    let writeError: unknown
    let writeQueue = Promise.resolve()

    workletNode.port.onmessage = (event: MessageEvent<{ type: 'data', buffer: ArrayBuffer } | { type: 'stopped' }>) => {
      if (event.data.type === 'stopped') {
        resolveWorkletStopped()
        return
      }

      const samples = new Float32Array(event.data.buffer)
      const audioBuffer = audioContext!.createBuffer(1, samples.length, audioContext!.sampleRate)
      audioBuffer.copyToChannel(samples, 0)
      writeQueue = writeQueue.then(async () => {
        if (writeError)
          return
        try {
          await audioSource.add(audioBuffer)
        }
        catch (error) {
          writeError = error
        }
      })
    }

    streamSource.connect(analyser)
    streamSource.connect(workletNode)
    workletNode.connect(audioContext.destination)
    if (audioContext.state === 'suspended')
      await audioContext.resume()

    let released = false
    const release = async () => {
      if (released)
        return
      released = true
      streamSource.disconnect()
      analyser.disconnect()
      workletNode.disconnect()
      stream?.getTracks().forEach(track => track.stop())
      await audioContext?.close()
    }

    let stopPromise: Promise<Blob> | undefined
    const stop = () => {
      stopPromise ??= (async () => {
        try {
          if (audioContext?.state === 'suspended')
            await audioContext.resume()
          workletNode.port.postMessage({ type: 'stop' })
          await workletStopped
          await writeQueue
          if (writeError) {
            await output!.cancel()
            throw writeError
          }
          await output!.finalize()
          if (!target.buffer?.byteLength)
            throw new Error('The MP3 encoder produced no audio data.')
          return new Blob([target.buffer], { type: AUDIO_MIME_TYPE })
        }
        finally {
          await release()
        }
      })()
      return stopPromise
    }

    const cancel = async () => {
      if (stopPromise) {
        try {
          await stopPromise
        }
        catch {}
        return
      }
      try {
        await output!.cancel()
      }
      finally {
        await release()
      }
    }

    return { analyser, stop, cancel }
  }
  catch (error) {
    await output?.cancel()
    stream?.getTracks().forEach(track => track.stop())
    await audioContext?.close()
    throw error
  }
}
