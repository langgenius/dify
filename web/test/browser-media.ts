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

const VIDEO_BASE64 =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMwbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAZAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlt0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAZAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAGQAAAAAAABAAAAAAHTbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAEABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABfm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAT5zdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADACg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAADi4AAAAAAAAABhzdHRzAAAAAAAAAAEAAAACAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAACAAACygAAAAwAAAAUc3RjbwAAAAAAAAABAAADYAAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDIAAAAIZnJlZQAAAt5tZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAVZYiEABD//ubA+ZZaIeOAUIdrhk+BAAAACEGaIWxD//7g'

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
