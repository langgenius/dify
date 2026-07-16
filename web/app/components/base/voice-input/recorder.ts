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

function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise

  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener('abort', handleAbort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort)
        reject(error)
      },
    )
  })
}

export async function startVoiceRecorder(signal?: AbortSignal): Promise<VoiceRecorder> {
  let stream: MediaStream | undefined
  let audioContext: AudioContext | undefined
  let output:
    | Awaited<ReturnType<typeof import('./mp3-encoder').createMp3Encoder>>['output']
    | undefined
  let streamStopped = false
  const stopStream = () => {
    if (!stream || streamStopped) return
    streamStopped = true
    stream.getTracks().forEach((track) => track.stop())
  }

  try {
    signal?.throwIfAborted()
    const { createMp3Encoder } = await waitForAbort(import('./mp3-encoder'), signal)
    signal?.throwIfAborted()
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
    signal?.addEventListener('abort', stopStream, { once: true })
    signal?.throwIfAborted()

    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) throw new Error('No audio track is available.')

    const context = new AudioContext()
    audioContext = context
    const workletUrl = URL.createObjectURL(
      new Blob([AUDIO_WORKLET_SOURCE], { type: 'application/javascript' }),
    )
    try {
      await waitForAbort(context.audioWorklet.addModule(workletUrl), signal)
    } finally {
      URL.revokeObjectURL(workletUrl)
    }

    const encoder = createMp3Encoder()
    const { audioSource, target } = encoder
    output = encoder.output
    await waitForAbort(output.start(), signal)

    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    const streamSource = context.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(context, AUDIO_WORKLET_NAME)
    let resolveWorkletStopped: () => void = () => {}
    const workletStopped = new Promise<void>((resolve) => {
      resolveWorkletStopped = resolve
    })
    let writeError: unknown
    let writeQueue = Promise.resolve()

    workletNode.port.onmessage = (
      event: MessageEvent<{ type: 'data'; buffer: ArrayBuffer } | { type: 'stopped' }>,
    ) => {
      if (event.data.type === 'stopped') {
        resolveWorkletStopped()
        return
      }

      const samples = new Float32Array(event.data.buffer)
      const audioBuffer = context.createBuffer(1, samples.length, context.sampleRate)
      audioBuffer.copyToChannel(samples, 0)
      writeQueue = writeQueue.then(async () => {
        if (writeError) return
        try {
          await audioSource.add(audioBuffer)
        } catch (error) {
          writeError = error
        }
      })
    }

    streamSource.connect(analyser)
    streamSource.connect(workletNode)
    workletNode.connect(context.destination)
    if (context.state === 'suspended') await waitForAbort(context.resume(), signal)

    let releasePromise: Promise<void> | undefined
    const release = () => {
      releasePromise ??= (async () => {
        stopStream()
        await Promise.allSettled([
          (async () => streamSource.disconnect())(),
          (async () => analyser.disconnect())(),
          (async () => workletNode.disconnect())(),
          (async () => context.close())(),
        ])
      })()
      return releasePromise
    }

    let cancelled = false
    let resolveCancelled: () => void = () => {}
    const cancellation = new Promise<void>((resolve) => {
      resolveCancelled = resolve
    })
    const waitForCancellation = async <T>(promise: Promise<T>) => {
      await Promise.race([promise, cancellation])
      if (cancelled) throw new DOMException('Recording cancelled.', 'AbortError')
      return promise
    }

    let stopPromise: Promise<Blob> | undefined
    const stop = () => {
      stopPromise ??= (async () => {
        try {
          if (context.state === 'suspended') await context.resume()
          workletNode.port.postMessage({ type: 'stop' })
          await waitForCancellation(workletStopped)
          await waitForCancellation(writeQueue)
          await release()
          if (writeError) {
            await output!.cancel()
            throw writeError
          }
          await waitForCancellation(output!.finalize())
          if (!target.buffer?.byteLength) throw new Error('The MP3 encoder produced no audio data.')
          return new Blob([target.buffer], { type: AUDIO_MIME_TYPE })
        } finally {
          await release()
        }
      })()
      return stopPromise
    }

    const cancel = async () => {
      cancelled = true
      resolveCancelled()
      await release()
      await Promise.allSettled([output!.cancel()])
    }

    signal?.throwIfAborted()
    signal?.removeEventListener('abort', stopStream)
    return { analyser, stop, cancel }
  } catch (error) {
    signal?.removeEventListener('abort', stopStream)
    stopStream()
    await Promise.allSettled([audioContext?.close(), output?.cancel()])
    throw error
  }
}
