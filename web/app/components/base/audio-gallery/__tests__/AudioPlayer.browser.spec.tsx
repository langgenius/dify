import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createWavFixture, paintedPixelCount } from '@/test/browser-media'
import AudioPlayer from '../AudioPlayer'

const fixtures: Array<ReturnType<typeof createWavFixture>> = []
const fixture = (options?: Parameters<typeof createWavFixture>[0]) => {
  const result = createWavFixture(options)
  fixtures.push(result)
  return result
}

function AudioSourceCaller({
  initial,
  label,
  next,
}: {
  initial: string
  label: string
  next: string
}) {
  const [src, setSrc] = useState(initial)
  return (
    <>
      <button type="button" onClick={() => setSrc(next)}>
        {label}
      </button>
      <AudioPlayer src={src} />
    </>
  )
}

afterEach(() => {
  fixtures.splice(0).forEach(({ revoke }) => revoke())
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('plays, pauses and finishes real audio through the keyboard controls', async () => {
  const { url } = fixture()
  const screen = await render(
    <div style={{ width: 420 }}>
      <AudioPlayer src={url} />
    </div>,
  )
  const audio = screen.getByTestId('audio-player').element() as HTMLAudioElement
  await expect.poll(() => audio.duration).toBeGreaterThan(1.9)
  await expect.element(screen.getByText('0:02')).toBeVisible()

  const play = screen.getByRole('button', { name: 'common.operation.play' })
  await userEvent.keyboard('{Tab}')
  await expect.element(play).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => audio.paused).toBe(false)
  await expect.element(screen.getByRole('button', { name: 'common.operation.pause' })).toBeVisible()

  await userEvent.keyboard('{Enter}')
  await expect.poll(() => audio.paused).toBe(true)
  await expect.element(screen.getByRole('button', { name: 'common.operation.play' })).toBeVisible()

  audio.currentTime = audio.duration - 0.05
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('button', { name: 'common.operation.play' })).toBeVisible()
  expect(audio.ended).toBe(true)
})

it.fails('keeps the available waveform and playback control pointer-reachable', async () => {
  // TODO(https://github.com/langgenius/dify/issues/45655): the hidden overlay wins hit testing.
  const { url } = fixture()
  const screen = await render(<AudioPlayer src={url} />)
  const audio = screen.getByTestId('audio-player').element() as HTMLAudioElement
  await expect.poll(() => audio.duration).toBeGreaterThan(0)
  const canvas = screen.getByTestId('waveform-canvas').element()
  const { left, top, width, height } = canvas.getBoundingClientRect()
  expect(document.elementFromPoint(left + width / 2, top + height / 2)).toBe(canvas)
})

it('decodes the first alternative source into a painted waveform', async () => {
  // boundary: advance only the waveform delay; native decoding and animation frames stay real.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  const first = fixture({ frequency: 220 })
  const second = fixture({ frequency: 880 })
  const nativeFetch = window.fetch.bind(window)
  // boundary: waveform resource request identity is observable at native fetch; canvas and decoder stay real.
  const waveformFetch = vi.spyOn(window, 'fetch').mockImplementation(nativeFetch)
  const screen = await render(<AudioPlayer srcs={[first.url, second.url]} />)
  const audio = screen.getByTestId('audio-player').element() as HTMLAudioElement
  const sources = Array.from(audio.querySelectorAll('source'), (source) => source.src)
  expect(sources).toEqual([first.url, second.url])
  await expect.poll(() => audio.currentSrc).toBe(first.url)
  await expect.poll(() => audio.duration).toBeGreaterThan(1.9)
  await vi.advanceTimersByTimeAsync(1_000)
  await expect.poll(() => waveformFetch.mock.calls[0]?.[0]).toBe(first.url)
  const canvas = screen.getByTestId('waveform-canvas').element() as HTMLCanvasElement
  await expect.poll(() => paintedPixelCount(canvas)).toBeGreaterThan(100)
})

it('keeps a rejected playback attempt visible and retryable', async () => {
  const { url } = fixture()
  const screen = await render(<AudioPlayer src={url} />)
  const audio = screen.getByTestId('audio-player').element() as HTMLAudioElement
  await expect.poll(() => audio.duration).toBeGreaterThan(0)
  const nativePlay = audio.play.bind(audio)
  // boundary: emulate one browser autoplay denial, then delegate retries to native playback.
  vi.spyOn(audio, 'play')
    .mockRejectedValueOnce(new DOMException('Playback denied', 'NotAllowedError'))
    .mockImplementation(nativePlay)
  // boundary: suppress the expected production log from the intentional playback denial.
  vi.spyOn(console, 'error').mockImplementation(() => {})

  const play = screen.getByRole('button', { name: 'common.operation.play' })
  await userEvent.keyboard('{Tab}')
  await expect.element(play).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('button', { name: 'common.operation.play' })).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => audio.paused).toBe(false)
  await expect.element(screen.getByRole('button', { name: 'common.operation.pause' })).toBeVisible()
})

it('recovers from an unavailable source when the caller supplies a valid replacement', async () => {
  const invalid = fixture()
  invalid.revoke()
  const valid = fixture()

  const screen = await render(
    <AudioSourceCaller initial={invalid.url} label="Use valid audio" next={valid.url} />,
  )
  await expect.element(screen.getByText('common.operation.audioSourceUnavailable')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'common.operation.play' })).toBeDisabled()
  await screen.getByRole('button', { name: 'Use valid audio' }).click()
  const audio = screen.getByTestId('audio-player').element() as HTMLAudioElement
  await expect.poll(() => audio.src).toBe(valid.url)
  await expect.poll(() => audio.duration).toBeGreaterThan(0)
  await expect.element(screen.getByRole('button', { name: 'common.operation.play' })).toBeEnabled()
})

it('ignores a failed waveform response from the previous public source', async () => {
  // boundary: advance only the waveform delay while preserving the native response race.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  const oldAudio = fixture({ frequency: 220 })
  const newAudio = fixture({ frequency: 660 })
  const nativeFetch = window.fetch.bind(window)
  let rejectOld!: () => void
  const oldResponse = new Promise<Response>((resolve) => {
    rejectOld = () => resolve(new Response(null, { status: 403 }))
  })
  // boundary: hold one blob fetch to reproduce an out-of-order browser response.
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    if (String(input) === oldAudio.url) return oldResponse
    return nativeFetch(input, init)
  })

  const screen = await render(
    <AudioSourceCaller initial={oldAudio.url} label="Use next audio" next={newAudio.url} />,
  )
  await vi.advanceTimersByTimeAsync(1_000)
  await expect.poll(() => vi.mocked(window.fetch).mock.calls.length).toBe(1)
  await screen.getByRole('button', { name: 'Use next audio' }).click()
  const audio = screen.getByTestId('audio-player').element() as HTMLAudioElement
  await expect.poll(() => audio.src).toBe(newAudio.url)
  await vi.advanceTimersByTimeAsync(1_000)
  const canvas = screen.getByTestId('waveform-canvas').element() as HTMLCanvasElement
  await expect.poll(() => paintedPixelCount(canvas)).toBeGreaterThan(100)
  rejectOld()
  await oldResponse
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await expect.element(screen.getByRole('button', { name: 'common.operation.play' })).toBeEnabled()
  expect(audio.src).toBe(newAudio.url)
})
