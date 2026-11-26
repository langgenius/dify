import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createWavFixture, paintedPixelCount } from '@/test/browser-media'
import { hold, route, setupFakeApi } from '@/test/fake-api'
import servedAudioUrl from '@/test/fixtures/media/preview.mp3?url'
import AudioPlayer from '../AudioPlayer'

const fixtures: Array<ReturnType<typeof createWavFixture>> = []
const fixture = (options?: Parameters<typeof createWavFixture>[0]) => {
  const result = createWavFixture(options)
  fixtures.push(result)
  return result
}

// The audio element loads the served file natively; the waveform request goes through the fake API.
const servedAudio = () => new URL(servedAudioUrl, window.location.href)
let servedWaveform: Uint8Array
const fake = setupFakeApi(() => ({
  routes: [
    route('GET', 'origin', servedAudio().pathname, () => new Response(servedWaveform as BlobPart)),
  ],
}))
const waveformRequest = () => fake.route('GET', 'origin', servedAudio().pathname)

beforeEach(() => {
  servedWaveform = createWavFixture({ frequency: 220 }).bytes
})

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

it('keeps the available waveform and playback control pointer-reachable', async () => {
  const { url } = fixture()
  const screen = await render(<AudioPlayer src={url} />)
  const audio = screen.getByTestId('audio-player').element() as HTMLAudioElement
  await expect.poll(() => audio.duration).toBeGreaterThan(0)
  const canvas = screen.getByTestId('waveform-canvas').element()
  const { left, top, width, height } = canvas.getBoundingClientRect()
  // TODO(https://github.com/langgenius/dify/issues/45655): the hidden overlay wins hit testing.
  // Only this check asserts the known bug, so the rest of the test and the fake API contract still
  // fail normally; once fixed, expect the hit target `toBe(canvas)` instead.
  expect(document.elementFromPoint(left + width / 2, top + height / 2)).not.toBe(canvas)
})

it('decodes the first alternative source into a painted waveform', async () => {
  // boundary: advance only the waveform delay; native decoding and animation frames stay real.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  const first = servedAudio().href
  const second = fixture({ frequency: 880 })
  const screen = await render(<AudioPlayer srcs={[first, second.url]} />)
  const audio = screen.getByTestId('audio-player').element() as HTMLAudioElement
  const sources = Array.from(audio.querySelectorAll('source'), (source) => source.src)
  expect(sources).toEqual([first, second.url])
  await expect.poll(() => audio.currentSrc).toBe(first)
  await expect.poll(() => audio.duration).toBeGreaterThan(0)
  await vi.advanceTimersByTimeAsync(1_000)
  await expect.poll(() => waveformRequest()).toHaveBeenCalledTimes(1)
  expect(waveformRequest().mock.calls[0]![0].url.href).toBe(first)
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
  const oldAudio = servedAudio().href
  const newAudio = fixture({ frequency: 660 })
  // Hold the old source's waveform response to reproduce an out-of-order server response.
  const oldResponse = hold(waveformRequest())

  const screen = await render(
    <AudioSourceCaller initial={oldAudio} label="Use next audio" next={newAudio.url} />,
  )
  await vi.advanceTimersByTimeAsync(1_000)
  await oldResponse.arrived
  await screen.getByRole('button', { name: 'Use next audio' }).click()
  const audio = screen.getByTestId('audio-player').element() as HTMLAudioElement
  await expect.poll(() => audio.src).toBe(newAudio.url)
  await vi.advanceTimersByTimeAsync(1_000)
  const canvas = screen.getByTestId('waveform-canvas').element() as HTMLCanvasElement
  await expect.poll(() => paintedPixelCount(canvas)).toBeGreaterThan(100)
  oldResponse.resolve(new Response(null, { status: 403 }))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await expect.element(screen.getByRole('button', { name: 'common.operation.play' })).toBeEnabled()
  expect(audio.src).toBe(newAudio.url)
})
