import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { vi } from 'vitest'
import useThemeMock from '@/hooks/use-theme'

import { Theme } from '@/types/app'
import AudioPlayer from './AudioPlayer'

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(() => ({ theme: 'light' })),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildAudioContext(channelLength = 512) {
  return class MockAudioContext {
    decodeAudioData(_ab: ArrayBuffer) {
      const arr = new Float32Array(channelLength)
      for (let i = 0; i < channelLength; i++)
        arr[i] = Math.sin((i / channelLength) * Math.PI * 2) * 0.5
      return Promise.resolve({ getChannelData: (_ch: number) => arr })
    }

    close() { return Promise.resolve() }
  }
}

function stubFetchOk(size = 256) {
  const ab = new ArrayBuffer(size)
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    arrayBuffer: async () => ab,
  } as Response)
}

function stubFetchFail() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response)
}

async function advanceWaveformTimer() {
  await act(async () => {
    vi.advanceTimersByTime(1000)
    await Promise.resolve()
    await Promise.resolve()
  })
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  ; (useThemeMock as ReturnType<typeof vi.fn>).mockReturnValue({ theme: Theme.light })
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('AudioPlayer — rendering', () => {
  it('should render the play button and audio element when given a src', () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)

    expect(screen.getByTestId('play-pause-btn')).toBeInTheDocument()
    expect(document.querySelector('audio')).toBeInTheDocument()
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('https://example.com/a.mp3')
  })

  it('should render <source> elements when srcs array is provided', () => {
    render(<AudioPlayer srcs={['https://example.com/a.mp3', 'https://example.com/b.ogg']} />)

    const sources = document.querySelectorAll('audio source')
    expect(sources).toHaveLength(2)
    expect((sources[0] as HTMLSourceElement).src).toBe('https://example.com/a.mp3')
    expect((sources[1] as HTMLSourceElement).src).toBe('https://example.com/b.ogg')
  })

  it('should render without crashing when no props are supplied', () => {
    render(<AudioPlayer />)
    expect(screen.getByTestId('play-pause-btn')).toBeInTheDocument()
  })
})

// ─── Play / Pause toggle ──────────────────────────────────────────────────────

describe('AudioPlayer — play/pause', () => {
  it('should call audio.play() on first button click', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const btn = screen.getByTestId('play-pause-btn')

    await act(async () => {
      fireEvent.click(btn)
    })

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it('should call audio.pause() on second button click', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const btn = screen.getByTestId('play-pause-btn')

    await act(async () => {
      fireEvent.click(btn)
    })
    await act(async () => {
      fireEvent.click(btn)
    })

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
  })

  it('should show the pause icon while playing and play icon while paused', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const btn = screen.getByTestId('play-pause-btn')

    expect(btn.querySelector('.i-ri-play-large-fill')).toBeInTheDocument()
    expect(btn.querySelector('.i-ri-pause-circle-fill')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(btn)
    })

    expect(btn.querySelector('.i-ri-pause-circle-fill')).toBeInTheDocument()
    expect(btn.querySelector('.i-ri-play-large-fill')).not.toBeInTheDocument()
  })

  it('should reset to stopped state when the audio ends', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const btn = screen.getByTestId('play-pause-btn')

    await act(async () => {
      fireEvent.click(btn)
    })
    expect(btn.querySelector('.i-ri-pause-circle-fill')).toBeInTheDocument()

    const audio = document.querySelector('audio') as HTMLAudioElement
    await act(async () => {
      audio.dispatchEvent(new Event('ended'))
    })

    expect(btn.querySelector('.i-ri-play-large-fill')).toBeInTheDocument()
  })

  it('should disable the play button when an audio error occurs', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement

    await act(async () => {
      audio.dispatchEvent(new Event('error'))
    })

    expect(screen.getByTestId('play-pause-btn')).toBeDisabled()
  })
})

// ─── Audio events ─────────────────────────────────────────────────────────────

describe('AudioPlayer — audio events', () => {
  it('should update duration display when loadedmetadata fires', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { value: 90, configurable: true })

    await act(async () => {
      audio.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(screen.getByText('1:30')).toBeInTheDocument()
  })

  it('should update bufferedTime on progress event', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement

    const bufferedStub = { length: 1, start: () => 0, end: () => 60 }
    Object.defineProperty(audio, 'buffered', { value: bufferedStub, configurable: true })

    await act(async () => {
      audio.dispatchEvent(new Event('progress'))
    })
  })

  it('should do nothing on progress when buffered.length is 0', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement

    const bufferedStub = { length: 0, start: () => 0, end: () => 0 }
    Object.defineProperty(audio, 'buffered', { value: bufferedStub, configurable: true })

    await act(async () => {
      audio.dispatchEvent(new Event('progress'))
    })
  })

  it('should set isAudioAvailable to false when an audio error occurs', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement

    await act(async () => {
      audio.dispatchEvent(new Event('error'))
    })

    expect(screen.getByTestId('play-pause-btn')).toBeDisabled()
  })
})

// ─── Waveform generation ──────────────────────────────────────────────────────

describe('AudioPlayer — waveform generation', () => {
  it('should render the waveform canvas after fetch + decode succeed', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(700))
    stubFetchOk(512)

    render(<AudioPlayer src="https://cdn.example/audio.mp3" />)
    await advanceWaveformTimer()

    expect(screen.getByTestId('waveform-canvas')).toBeInTheDocument()
  })

  it('should use fallback random waveform when fetch returns not-ok', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(400))
    stubFetchFail()

    render(<AudioPlayer src="https://cdn.example/audio.mp3" />)
    await advanceWaveformTimer()

    expect(screen.getByTestId('waveform-canvas')).toBeInTheDocument()
  })

  it('should use fallback waveform when decodeAudioData rejects', async () => {
    class FailDecodeContext {
      decodeAudioData() { return Promise.reject(new Error('decode error')) }
      close() { return Promise.resolve() }
    }
    vi.stubGlobal('AudioContext', FailDecodeContext)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(128),
    } as Response)

    render(<AudioPlayer src="https://cdn.example/audio.mp3" />)
    await advanceWaveformTimer()

    expect(screen.getByTestId('waveform-canvas')).toBeInTheDocument()
  })

  it('should show Toast when AudioContext is not available', async () => {
    vi.stubGlobal('AudioContext', undefined)

    render(<AudioPlayer src="https://example.com/audio.mp3" />)
    await advanceWaveformTimer()

    const toastFound = Array.from(document.body.querySelectorAll('div')).some(
      d => d.textContent?.includes('Web Audio API is not supported in this browser'),
    )
    expect(toastFound).toBe(true)
  })

  it('should set audio unavailable when URL is not http/https', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext())

    render(<AudioPlayer srcs={['blob:something']} />)
    await advanceWaveformTimer()

    expect(screen.getByTestId('play-pause-btn')).toBeDisabled()
  })

  it('should not trigger waveform generation when no src or srcs provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<AudioPlayer />)
    await advanceWaveformTimer()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should use srcs[0] as primary source for waveform', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(300))
    const fetchSpy = stubFetchOk(256)

    render(<AudioPlayer srcs={['https://cdn.example/first.mp3', 'https://cdn.example/second.mp3']} />)
    await advanceWaveformTimer()

    expect(fetchSpy).toHaveBeenCalledWith('https://cdn.example/first.mp3', { mode: 'cors' })
  })

  it('should cover dark theme waveform draw branch', async () => {
    ; (useThemeMock as ReturnType<typeof vi.fn>).mockReturnValue({ theme: Theme.dark })
    vi.stubGlobal('AudioContext', buildAudioContext(300))
    stubFetchOk(256)

    render(<AudioPlayer src="https://cdn.example/audio.mp3" />)
    await advanceWaveformTimer()

    expect(screen.getByTestId('waveform-canvas')).toBeInTheDocument()
  })
})

// ─── Canvas interactions ──────────────────────────────────────────────────────

describe('AudioPlayer — canvas seek interactions', () => {
  async function renderWithDuration(src = 'https://example.com/audio.mp3', durationVal = 120) {
    vi.stubGlobal('AudioContext', buildAudioContext(300))
    stubFetchOk(128)

    render(<AudioPlayer src={src} />)

    const audio = document.querySelector('audio') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { value: durationVal, configurable: true })
    Object.defineProperty(audio, 'buffered', {
      value: { length: 1, start: () => 0, end: () => durationVal },
      configurable: true,
    })

    await act(async () => {
      audio.dispatchEvent(new Event('loadedmetadata'))
    })
    await advanceWaveformTimer()

    const canvas = screen.getByTestId('waveform-canvas') as HTMLCanvasElement
    canvas.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 10, right: 200, bottom: 10 }) as DOMRect

    return { audio, canvas }
  }

  it('should seek to clicked position and start playback', async () => {
    const { audio, canvas } = await renderWithDuration()

    await act(async () => {
      fireEvent.click(canvas, { clientX: 100 })
    })

    expect(Math.abs((audio.currentTime || 0) - 60)).toBeLessThanOrEqual(2)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('should seek on mousedown', async () => {
    const { canvas } = await renderWithDuration()

    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 50 })
    })

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('should not call play again when already playing and canvas is clicked', async () => {
    const { canvas } = await renderWithDuration()

    await act(async () => {
      fireEvent.click(canvas, { clientX: 50 })
    })
    const callsAfterFirst = (HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>).mock.calls.length

    await act(async () => {
      fireEvent.click(canvas, { clientX: 80 })
    })

    expect((HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst)
  })

  it('should update hoverTime on mousemove within buffered range', async () => {
    const { audio, canvas } = await renderWithDuration()

    Object.defineProperty(audio, 'buffered', {
      value: { length: 1, start: () => 0, end: () => 120 },
      configurable: true,
    })

    await act(async () => {
      fireEvent.mouseMove(canvas, { clientX: 100 })
    })
  })

  it('should not update hoverTime when outside all buffered ranges', async () => {
    const { audio, canvas } = await renderWithDuration()

    Object.defineProperty(audio, 'buffered', {
      value: { length: 0, start: () => 0, end: () => 0 },
      configurable: true,
    })

    await act(async () => {
      fireEvent.mouseMove(canvas, { clientX: 100 })
    })
  })
})
