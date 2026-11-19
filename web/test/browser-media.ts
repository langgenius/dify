type WavFixture = {
  bytes: Uint8Array
  revoke: () => void
  url: string
}

export type MicrophoneFixture = {
  context: AudioContext
  dispose: () => Promise<void>
  resume: () => Promise<void>
  stream: MediaStream
  track: MediaStreamTrack
}

// One second of 16x16 video at 12 fps, with frames on both sides of the 75% seek target.
const VIDEO_BASE64 =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMsbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAnt0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHzbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAMABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABnm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAV5zdGJsAAAAtnN0c2QAAAAAAAAAAQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAADABAAAAMBiPEiagEABGjOD8gAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAD0AAAAAAAAAAYc3R0cwAAAAAAAAABAAAADAAABAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAADAAAAAEAAABEc3RzegAAAAAAAAAAAAAADAAAABcAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAABRzdGNvAAAAAAAAAAEAAANcAAAAPXVkdGEAAAA1bWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAIaWxzdAAAAAhmcmVlAAAAgm1kYXQAAAATZYiEOhGKAAIxccAAQ8o4AAgF4AAAAAVBmiAylAAAAAVBmkAylAAAAAVBmmA2lAAAAAVBmoA2lAAAAAVBmqA2lAAAAAVBmsA2lAAAAAVBmuA2lAAAAAVBmwA2lAAAAAVBmyA2lAAAAAVBm0A2lAAAAAVBm2A2lA=='

export const createWavFixture = ({
  duration = 2,
  frequency = 440,
}: {
  duration?: number
  frequency?: number
} = {}): WavFixture => {
  const sampleRate = 8_000
  const sampleCount = Math.round(sampleRate * duration)
  const bytes = new Uint8Array(44 + sampleCount * 2)
  const view = new DataView(bytes.buffer)
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index))
  }

  write(0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, sampleCount * 2, true)
  for (let index = 0; index < sampleCount; index++) {
    const fade = Math.min(1, index / 80, (sampleCount - index) / 80)
    const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.35 * fade
    view.setInt16(44 + index * 2, sample * 0x7fff, true)
  }

  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  return { bytes, url, revoke: () => URL.revokeObjectURL(url) }
}

export const createVideoFixture = (): WavFixture => {
  const binary = atob(VIDEO_BASE64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
  return { bytes, url, revoke: () => URL.revokeObjectURL(url) }
}

export const createMicrophoneFixture = (): MicrophoneFixture => {
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const destination = context.createMediaStreamDestination()
  const track = destination.stream.getAudioTracks()[0]!
  let disposed = false

  oscillator.frequency.value = 440
  gain.gain.value = 0.15
  oscillator.connect(gain)
  gain.connect(destination)
  oscillator.start()

  return {
    context,
    stream: destination.stream,
    track,
    resume: async () => {
      if (context.state === 'suspended') await context.resume()
    },
    dispose: async () => {
      if (disposed) return
      disposed = true
      track.stop()
      try {
        oscillator.stop()
      } catch {
        // The oscillator may already have stopped while its context was released.
      }
      oscillator.disconnect()
      gain.disconnect()
      destination.disconnect()
      if (context.state !== 'closed') await context.close()
    },
  }
}

export const paintedPixelCount = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d')
  if (!context) return 0
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  let count = 0
  for (let index = 3; index < data.length; index += 4) {
    if (data[index]) count++
  }
  return count
}
