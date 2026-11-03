import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import AudioPlayer from '../AudioPlayer'

const decode = vi.fn()
const close = vi.fn()
const drawBar = vi.fn()
const getAudio = () => screen.getByTestId('audio-player') as HTMLAudioElement
const playButton = () => screen.getByRole('button', { name: 'common.operation.play' })
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
async function generateWaveform() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
}
function loadMetadata(duration = 120) {
  const audio = getAudio()
  Object.defineProperty(audio, 'duration', { configurable: true, value: duration })
  fireEvent.loadedMetadata(audio)
  const canvas = screen.getByTestId('waveform-canvas')
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 20,
    right: 200,
    bottom: 20,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  return { audio, canvas }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.clearAllMocks()
  decode.mockResolvedValue({ getChannelData: () => new Float32Array(140).fill(0.5) })
  close.mockResolvedValue(undefined)
  vi.stubGlobal(
    'AudioContext',
    class {
      decodeAudioData = decode
      close = close
    },
  )
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ArrayBuffer(128))))
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: drawBar,
    fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AudioPlayer', () => {
  it('plays, pauses, and returns to play when playback ends', async () => {
    const interaction = user()
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    await interaction.click(playButton())
    expect(getAudio().play).toHaveBeenCalledOnce()
    await interaction.click(screen.getByRole('button', { name: 'common.operation.pause' }))
    expect(getAudio().pause).toHaveBeenCalledOnce()
    await interaction.click(playButton())
    fireEvent.ended(getAudio())
    expect(playButton()).toBeEnabled()
  })

  it('keeps a rejected playback attempt retryable', async () => {
    const interaction = user()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Playback denied'))
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    await interaction.click(playButton())
    expect(playButton()).toBeEnabled()
    await interaction.click(playButton())
    expect(getAudio().play).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'common.operation.pause' })).toBeInTheDocument()
  })

  it('reports an unavailable source and prevents playback after a media error', async () => {
    const interaction = user()
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    fireEvent.error(getAudio())
    await interaction.click(playButton())
    expect(playButton()).toBeDisabled()
    expect(screen.getByText('common.operation.audioSourceUnavailable')).toBeVisible()
    expect(getAudio().play).not.toHaveBeenCalled()
  })

  it('loads the first alternative source and displays its duration', async () => {
    render(<AudioPlayer srcs={['https://example.com/a.mp3', 'https://example.com/b.ogg']} />)
    loadMetadata(90)
    expect(screen.getByText('1:30')).toBeInTheDocument()
    expect(Array.from(getAudio().querySelectorAll('source'), (source) => source.src)).toEqual([
      'https://example.com/a.mp3',
      'https://example.com/b.ogg',
    ])
    await generateWaveform()
    expect(fetch).toHaveBeenCalledWith('https://example.com/a.mp3', { mode: 'cors' })
    expect(decode).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    ['silence', new Float32Array(140)],
    ['short audio', new Float32Array([0.1, -0.2, 0.3])],
  ])('draws finite waveform bars for %s', async (_name, samples) => {
    decode.mockResolvedValue({ getChannelData: () => samples })
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    await generateWaveform()
    expect(drawBar).toHaveBeenCalledTimes(70)
    for (const call of drawBar.mock.calls) expect(call.every(Number.isFinite)).toBe(true)
    expect(playButton()).toBeEnabled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps playback available when waveform decoding fails and closes the audio context', async () => {
    const interaction = user()
    decode.mockRejectedValue(new Error('Unsupported decoder'))
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    await generateWaveform()
    expect(close).toHaveBeenCalledOnce()
    expect(drawBar).toHaveBeenCalled()
    await interaction.click(playButton())
    expect(getAudio().play).toHaveBeenCalledOnce()
  })

  it('disables unavailable HTTP audio and releases its context', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }))
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    await generateWaveform()
    expect(playButton()).toBeDisabled()
    expect(decode).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it.each(['/audio.mp3', 'blob:https://example.com/audio'])(
    'supports playable source %s',
    async (src) => {
      render(<AudioPlayer src={src} />)
      await generateWaveform()
      expect(fetch).toHaveBeenCalledWith(src, { mode: 'cors' })
      expect(playButton()).toBeEnabled()
      expect(drawBar).toHaveBeenCalled()
    },
  )

  it('resets failed media on source change and ignores results from the old source', async () => {
    let resolveOld!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    const { rerender } = render(<AudioPlayer src="https://example.com/old.mp3" />)
    await generateWaveform()
    fireEvent.error(getAudio())
    expect(playButton()).toBeDisabled()
    rerender(<AudioPlayer src="https://example.com/new.mp3" />)
    expect(playButton()).toBeEnabled()
    await generateWaveform()
    await act(async () => {
      resolveOld(new Response(null, { status: 403 }))
    })
    expect(playButton()).toBeEnabled()
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('cancels scheduled waveform work when unmounted', async () => {
    const { unmount } = render(<AudioPlayer src="https://example.com/a.mp3" />)
    unmount()
    await generateWaveform()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['mouse', 'touch'] as const)(
    'seeks to the %s position and avoids restarting active playback',
    async (kind) => {
      render(<AudioPlayer src="https://example.com/a.mp3" />)
      const { audio, canvas } = loadMetadata()
      await act(async () => {
        if (kind === 'mouse') fireEvent.click(canvas, { clientX: 100 })
        else fireEvent.touchStart(canvas, { touches: [{ clientX: 100 }] })
      })
      expect(audio.currentTime).toBe(60)
      expect(audio.play).toHaveBeenCalledOnce()
      fireEvent.click(canvas, { clientX: 150 })
      expect(audio.currentTime).toBe(90)
      expect(audio.play).toHaveBeenCalledOnce()
    },
  )

  it('does not seek before metadata is available', () => {
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    fireEvent.click(screen.getByTestId('waveform-canvas'), { clientX: 100 })
    expect(getAudio().play).not.toHaveBeenCalled()
    expect(getAudio().currentTime).toBe(0)
  })

  it('returns to play and reports a rejected seek playback', async () => {
    const notify = vi.spyOn(toast, 'error').mockReturnValue('error')
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('Seek denied'))
    render(<AudioPlayer src="https://example.com/a.mp3" />)
    const { canvas } = loadMetadata()
    await act(async () => {
      fireEvent.click(canvas, { clientX: 100 })
    })
    expect(playButton()).toBeEnabled()
    expect(notify).toHaveBeenCalledWith('Error playing audio: Error: Seek denied')
  })
})
