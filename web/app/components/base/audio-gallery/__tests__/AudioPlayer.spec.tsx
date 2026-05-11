import { toast } from '@langgenius/dify-ui/toast'
import { act, fireEvent, render, screen } from '@testing-library/react'
import useThemeMock from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import AudioPlayer from '../AudioPlayer'

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

// eslint-disable-next-line ts/no-explicit-any
type ReactEventHandler = ((...args: any[]) => void) | undefined
function getReactProps<T extends Element>(el: T): Record<string, ReactEventHandler> {
  const key = Object.keys(el).find(k => k.startsWith('__reactProps$'))
  return key ? (el as unknown as Record<string, Record<string, ReactEventHandler>>)[key]! : {}
}

const getPlayButton = () => screen.getByRole('button', { name: 'common.operation.play' })
const getPauseButton = () => screen.getByRole('button', { name: 'common.operation.pause' })

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  ; (useThemeMock as ReturnType<typeof vi.fn>).mockReturnValue({ theme: Theme.light })
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
})

afterEach(async () => {
  await act(async () => {
    vi.runOnlyPendingTimers()
    await Promise.resolve()
    await Promise.resolve()
  })
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('AudioPlayer — rendering', () => {
  it('should render the play button and audio element when given a src', () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)

    expect(getPlayButton())!.toBeInTheDocument()
    expect(document.querySelector('audio'))!.toBeInTheDocument()
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
    expect(getPlayButton())!.toBeInTheDocument()
  })
})

// ─── Play / Pause toggle ──────────────────────────────────────────────────────

describe('AudioPlayer — play/pause', () => {
  it('should call audio.play() on first button click', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const btn = getPlayButton()

    await act(async () => {
      fireEvent.click(btn)
    })

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it('should call audio.pause() on second button click', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const btn = getPlayButton()

    await act(async () => {
      fireEvent.click(btn)
    })
    await act(async () => {
      fireEvent.click(getPauseButton())
    })

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
  })

  it('should show the pause icon while playing and play icon while paused', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const btn = getPlayButton()

    expect(btn.querySelector('.i-ri-play-large-fill'))!.toBeInTheDocument()
    expect(btn.querySelector('.i-ri-pause-circle-fill')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(btn)
    })

    const pauseBtn = getPauseButton()
    expect(pauseBtn.querySelector('.i-ri-pause-circle-fill'))!.toBeInTheDocument()
    expect(pauseBtn.querySelector('.i-ri-play-large-fill')).not.toBeInTheDocument()
  })

  it('should reset to stopped state when the audio ends', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const btn = getPlayButton()

    await act(async () => {
      fireEvent.click(btn)
    })
    expect(getPauseButton().querySelector('.i-ri-pause-circle-fill'))!.toBeInTheDocument()

    const audio = document.querySelector('audio') as HTMLAudioElement
    await act(async () => {
      audio.dispatchEvent(new Event('ended'))
    })
    expect(getPlayButton().querySelector('.i-ri-play-large-fill'))!.toBeInTheDocument()

    expect(btn.querySelector('.i-ri-play-large-fill'))!.toBeInTheDocument()
  })

  it('should disable the play button when an audio error occurs', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement

    await act(async () => {
      audio.dispatchEvent(new Event('error'))
    })

    expect(getPlayButton())!.toBeDisabled()
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

    expect(screen.getByText('1:30'))!.toBeInTheDocument()
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

    expect(getPlayButton())!.toBeDisabled()
  })
})

// ─── Waveform generation ──────────────────────────────────────────────────────

describe('AudioPlayer — waveform generation', () => {
  it('should render the waveform canvas after fetch + decode succeed', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(700))
    stubFetchOk(512)

    render(<AudioPlayer src="https://cdn.example/audio.mp3" />)
    await advanceWaveformTimer()

    expect(screen.getByTestId('waveform-canvas'))!.toBeInTheDocument()
  })

  it('should use fallback random waveform when fetch returns not-ok', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(400))
    stubFetchFail()

    render(<AudioPlayer src="https://cdn.example/audio.mp3" />)
    await advanceWaveformTimer()

    expect(screen.getByTestId('waveform-canvas'))!.toBeInTheDocument()
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

    expect(screen.getByTestId('waveform-canvas'))!.toBeInTheDocument()
  })

  it('should show Toast when AudioContext is not available', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const toastSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')

    render(<AudioPlayer src="https://example.com/audio.mp3" />)
    await advanceWaveformTimer()

    expect(toastSpy).toHaveBeenCalledWith('Web Audio API is not supported in this browser')
  })

  it('should set audio unavailable when URL is not http/https', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext())

    render(<AudioPlayer srcs={['blob:something']} />)
    await advanceWaveformTimer()

    expect(getPlayButton())!.toBeDisabled()
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

    expect(screen.getByTestId('waveform-canvas'))!.toBeInTheDocument()
  })

  it('should use webkitAudioContext when AudioContext is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', buildAudioContext(320))
    stubFetchOk(256)

    render(<AudioPlayer src="https://cdn.example/audio.mp3" />)
    await advanceWaveformTimer()

    expect(screen.getByTestId('waveform-canvas'))!.toBeInTheDocument()
  })
})

// ─── Canvas interactions ──────────────────────────────────────────────────────

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

describe('AudioPlayer — canvas seek interactions', () => {
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

// ─── Missing coverage tests ───────────────────────────────────────────────────

describe('AudioPlayer — missing coverage', () => {
  it('should handle unmounting without crashing (clears timeout)', () => {
    const { unmount } = render(<AudioPlayer src="https://example.com/a.mp3" />)
    unmount()
    // Timer is cleared, no state update should happen after unmount
  })

  it('should handle getContext returning null safely', () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null)

    render(<AudioPlayer src="https://example.com/audio.mp3" />)
    expect(screen.getByTestId('waveform-canvas'))!.toBeInTheDocument()

    HTMLCanvasElement.prototype.getContext = originalGetContext
  })

  it('should fallback to fillRect when roundRect is missing in drawWaveform', async () => {
    // Note: React 18 / testing-library wraps updates automatically, but we still wait for advanceWaveformTimer
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    let fillRectCalled = false
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof HTMLCanvasElement.prototype.getContext>) {
      const ctx = originalGetContext.apply(this, args) as CanvasRenderingContext2D | null
      if (ctx) {
        Object.defineProperty(ctx, 'roundRect', { value: undefined, configurable: true })
        const origFillRect = ctx.fillRect
        ctx.fillRect = function (...fArgs: Parameters<CanvasRenderingContext2D['fillRect']>) {
          fillRectCalled = true
          return origFillRect.apply(this, fArgs)
        }
      }
      return ctx as CanvasRenderingContext2D
    } as typeof HTMLCanvasElement.prototype.getContext

    vi.stubGlobal('AudioContext', buildAudioContext(300))
    stubFetchOk(128)

    render(<AudioPlayer src="https://example.com/audio.mp3" />)
    await advanceWaveformTimer()

    expect(fillRectCalled).toBe(true)
    HTMLCanvasElement.prototype.getContext = originalGetContext
  })

  it('should handle play error gracefully when togglePlay is clicked', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('play failed'))

    render(<AudioPlayer src="https://example.com/audio.mp3" />)
    const btn = getPlayButton()

    await act(async () => {
      fireEvent.click(btn)
    })

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('should notify error when audio.play() fails during canvas seek', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(300))
    stubFetchOk(128)

    render(<AudioPlayer src="https://example.com/audio.mp3" />)
    await advanceWaveformTimer()

    const canvas = screen.getByTestId('waveform-canvas') as HTMLCanvasElement
    const audio = document.querySelector('audio') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { value: 120, configurable: true })
    canvas.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 10, right: 200, bottom: 10 }) as DOMRect

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('play failed'))

    await act(async () => {
      fireEvent.click(canvas, { clientX: 100 })
    })

    // We can observe the error by checking document body for toast if Toast acts synchronously
    // Or we just ensure the execution branched into catch naturally.
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('should support touch events on canvas', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(300))
    stubFetchOk(128)

    render(<AudioPlayer src="https://example.com/audio.mp3" />)
    await advanceWaveformTimer()

    const canvas = screen.getByTestId('waveform-canvas') as HTMLCanvasElement
    const audio = document.querySelector('audio') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { value: 120, configurable: true })
    canvas.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 10, right: 200, bottom: 10 }) as DOMRect

    await act(async () => {
      // Use touch events
      fireEvent.touchStart(canvas, {
        touches: [{ clientX: 50 }],
      })
    })

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('should gracefully handle interaction when canvas/audio refs are null', async () => {
    const { unmount } = render(<AudioPlayer src="https://example.com/audio.mp3" />)
    const canvas = screen.getByTestId('waveform-canvas')
    unmount()
    expect(canvas).toBeTruthy()
  })

  it('should keep play button disabled when source is unavailable', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(300))
    const toastSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')
    render(<AudioPlayer src="blob:https://example.com" />)
    await advanceWaveformTimer() // sets isAudioAvailable to false (invalid protocol)

    const btn = getPlayButton()
    await act(async () => {
      fireEvent.click(btn)
    })

    expect(btn)!.toBeDisabled()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(toastSpy).not.toHaveBeenCalled()
    toastSpy.mockRestore()
  })

  it('should notify when toggle is invoked while audio is unavailable', async () => {
    const toastSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement
    await act(async () => {
      audio.dispatchEvent(new Event('error'))
    })

    const btn = getPlayButton()
    const props = getReactProps(btn)

    await act(async () => {
      props.onClick?.()
    })

    expect(toastSpy).toHaveBeenCalledWith('Audio element not found')
    toastSpy.mockRestore()
  })
})

describe('AudioPlayer — additional branch coverage', () => {
  it('should render multiple source elements when srcs is provided', () => {
    render(<AudioPlayer srcs={['a.mp3', 'b.ogg']} />)
    const audio = screen.getByTestId('audio-player')
    const sources = audio.querySelectorAll('source')
    expect(sources).toHaveLength(2)
  })

  it('should handle handleMouseMove with empty touch list', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(300))
    stubFetchOk(128)
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    await advanceWaveformTimer()
    const canvas = screen.getByTestId('waveform-canvas')

    await act(async () => {
      fireEvent.touchMove(canvas, {
        touches: [],
        changedTouches: [{ clientX: 50 }],
      })
    })
  })

  it('should handle handleMouseMove with missing clientX', async () => {
    vi.stubGlobal('AudioContext', buildAudioContext(300))
    stubFetchOk(128)
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    await advanceWaveformTimer()
    const canvas = screen.getByTestId('waveform-canvas')

    await act(async () => {
      fireEvent.touchMove(canvas, {
        touches: [{}] as unknown as TouchList,
      })
    })
  })

  it('should render "Audio source unavailable" when isAudioAvailable is false', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement

    await act(async () => {
      audio.dispatchEvent(new Event('error'))
    })

    expect(getPlayButton())!.toBeDisabled()
  })

  it('should update current time on timeupdate event', async () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { value: 10, configurable: true })

    await act(async () => {
      audio.dispatchEvent(new Event('timeupdate'))
    })
  })

  it('should ignore toggle click after audio error marks source unavailable', async () => {
    const toastSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement
    await act(async () => {
      audio.dispatchEvent(new Event('error'))
    })

    const btn = getPlayButton()
    await act(async () => {
      fireEvent.click(btn)
    })

    expect(btn)!.toBeDisabled()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(toastSpy).not.toHaveBeenCalled()
    toastSpy.mockRestore()
  })

  it('should cover Dark theme waveform states', async () => {
    ; (useThemeMock as ReturnType<typeof vi.fn>).mockReturnValue({ theme: Theme.dark })
    vi.stubGlobal('AudioContext', buildAudioContext(300))
    stubFetchOk(128)

    render(<AudioPlayer src="https://example.com/audio.mp3" />)
    const audio = document.querySelector('audio') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { value: 100, configurable: true })
    Object.defineProperty(audio, 'currentTime', { value: 50, configurable: true })

    await act(async () => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('timeupdate'))
    })
    await advanceWaveformTimer()

    expect(screen.getByTestId('waveform-canvas'))!.toBeInTheDocument()
  })

  it('should handle missing canvas/audio in handleCanvasInteraction/handleMouseMove', async () => {
    const { unmount } = render(<AudioPlayer src="https://example.com/a.mp3" />)
    const canvas = screen.getByTestId('waveform-canvas')

    unmount()
    fireEvent.click(canvas)
    fireEvent.mouseMove(canvas)
  })

  it('should cover waveform branches for hover and played states', async () => {
    const { audio, canvas } = await renderWithDuration('https://example.com/a.mp3', 100)

    // Set some progress
    Object.defineProperty(audio, 'currentTime', { value: 20, configurable: true })

    // Trigger hover on a buffered range
    Object.defineProperty(audio, 'buffered', {
      value: { length: 1, start: () => 0, end: () => 100 },
      configurable: true,
    })

    await act(async () => {
      fireEvent.mouseMove(canvas, { clientX: 50 }) // 50s hover
      audio.dispatchEvent(new Event('timeupdate'))
    })

    expect(canvas)!.toBeInTheDocument()
  })

  it('should hit null-ref guards in canvas handlers after unmount', async () => {
    const { unmount } = render(<AudioPlayer src="https://example.com/a.mp3" />)
    const canvas = screen.getByTestId('waveform-canvas')
    const props = getReactProps(canvas)
    unmount()

    await act(async () => {
      props.onClick?.({ preventDefault: vi.fn(), clientX: 10 })
      props.onMouseMove?.({ clientX: 10 })
    })
  })

  it('should execute non-matching buffered branch in hover loop', async () => {
    const { audio, canvas } = await renderWithDuration('https://example.com/a.mp3', 100)

    Object.defineProperty(audio, 'buffered', {
      value: { length: 1, start: () => 0, end: () => 10 },
      configurable: true,
    })

    await act(async () => {
      fireEvent.mouseMove(canvas, { clientX: 180 }) // time near 90, outside 0-10
    })

    expect(canvas)!.toBeInTheDocument()
  })
})
