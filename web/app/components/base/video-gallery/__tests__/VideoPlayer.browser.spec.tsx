import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createVideoFixture } from '@/test/browser-media'
import VideoPlayer from '../VideoPlayer'

const fixtures: Array<ReturnType<typeof createVideoFixture>> = []
const fixture = () => {
  const result = createVideoFixture()
  fixtures.push(result)
  return result
}

const renderPlayer = async (src = fixture().url) => {
  const screen = await render(
    <div style={{ width: '100vw' }}>
      <VideoPlayer src={src} />
    </div>,
  )
  const video = screen.getByTestId('video-element').element() as HTMLVideoElement
  await expect.poll(() => video.duration).toBeGreaterThan(0)
  return { screen, video }
}

afterEach(() => {
  fixtures.splice(0).forEach(({ revoke }) => revoke())
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('plays, pauses and returns to play after real media ends', async () => {
  await page.viewport(640, 640)
  const { screen, video } = await renderPlayer()
  video.playbackRate = 0.25
  const play = screen.getByRole('button', { name: 'common.operation.play' })
  await play.click()
  await expect.poll(() => video.paused).toBe(false)
  await expect.element(screen.getByRole('button', { name: 'common.operation.pause' })).toBeVisible()
  await screen.getByRole('button', { name: 'common.operation.pause' }).click()
  await expect.poll(() => video.paused).toBe(true)

  video.currentTime = Math.max(0, video.duration - 0.03)
  await screen.getByRole('button', { name: 'common.operation.play' }).click()
  await expect.element(screen.getByRole('button', { name: 'common.operation.play' })).toBeVisible()
  expect(video.ended).toBe(true)
})

it('seeks and changes volume at native pointer positions', async () => {
  await page.viewport(640, 640)
  const { screen, video } = await renderPlayer()
  const progress = screen.getByTestId('video-progress-bar')
  const progressBounds = progress.element().getBoundingClientRect()
  expect(progressBounds.width).toBeGreaterThan(400)
  await progress.hover({
    position: { x: progressBounds.width * 0.75, y: progressBounds.height / 2 },
  })
  await expect.element(screen.getByTestId('video-hover-time')).toBeVisible()
  await userEvent.click(progress, {
    position: { x: progressBounds.width * 0.75, y: progressBounds.height / 2 },
  })
  await expect.poll(() => video.currentTime / video.duration).toBeCloseTo(0.75, 1)

  const volume = screen.getByTestId('video-volume-slider')
  const volumeBounds = volume.element().getBoundingClientRect()
  await userEvent.click(volume, {
    position: { x: volumeBounds.width * 0.4, y: volumeBounds.height / 2 },
  })
  expect(video.volume).toBeCloseTo(0.4, 1)
  expect(video.muted).toBe(false)
  await userEvent.click(volume, { position: { x: 0, y: volumeBounds.height / 2 } })
  expect(video.volume).toBe(0)
  expect(video.muted).toBe(true)
  const mute = screen.getByRole('button', { name: 'common.operation.toggleMute' })
  await expect.element(mute).toHaveAttribute('aria-pressed', 'true')
  video.volume = 0.6
  await mute.click()
  expect(video.muted).toBe(false)
  expect(video.volume).toBeCloseTo(0.6)
})

it.fails('keeps the custom exit control available in native fullscreen', async () => {
  // TODO(https://github.com/langgenius/dify/issues/45656): sibling controls stay outside fullscreen.
  await page.viewport(640, 640)
  const { screen, video } = await renderPlayer()
  const fullscreen = screen.getByRole('button', { name: 'common.operation.toggleFullscreen' })
  try {
    await fullscreen.click()
    await expect.poll(() => document.fullscreenElement).toBe(video)
    const bounds = fullscreen.element().getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight)
    await fullscreen.click()
    await expect.poll(() => document.fullscreenElement).toBeNull()
  } finally {
    if (document.fullscreenElement) await document.exitFullscreen()
  }
})

it('uses the real container width to reveal desktop controls after a viewport change', async () => {
  await page.viewport(320, 640)
  const { screen } = await renderPlayer()
  await expect.element(screen.getByTestId('video-time-display')).not.toBeInTheDocument()
  await expect.element(screen.getByTestId('video-volume-slider')).not.toBeInTheDocument()

  await page.viewport(640, 640)
  await expect.element(screen.getByTestId('video-time-display')).toBeVisible()
  await expect.element(screen.getByTestId('video-volume-slider')).toBeVisible()
})

it('visually hides idle controls and reveals them on native hover', async () => {
  // boundary: advance only the idle delay; native hover and CSS opacity transitions stay real.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  await page.viewport(640, 640)
  const { screen } = await renderPlayer()
  const player = screen.getByTestId('video-player-container')
  const controls = screen.getByTestId('video-controls')
  await player.hover()
  await vi.advanceTimersByTimeAsync(3_001)
  await expect.poll(() => Number.parseFloat(getComputedStyle(controls.element()).opacity)).toBe(0)

  await userEvent.unhover(player)
  await player.hover()
  await expect.poll(() => Number.parseFloat(getComputedStyle(controls.element()).opacity)).toBe(1)
})

it('keeps a rejected playback attempt retryable', async () => {
  await page.viewport(640, 640)
  const { screen, video } = await renderPlayer()
  const nativePlay = video.play.bind(video)
  // boundary: emulate one browser autoplay denial, then delegate retries to native playback.
  vi.spyOn(video, 'play')
    .mockRejectedValueOnce(new DOMException('Playback denied', 'NotAllowedError'))
    .mockImplementation(nativePlay)
  // boundary: suppress the expected production log from the intentional playback denial.
  vi.spyOn(console, 'error').mockImplementation(() => {})

  await screen.getByRole('button', { name: 'common.operation.play' }).click()
  await expect.element(screen.getByRole('button', { name: 'common.operation.play' })).toBeVisible()
  await screen.getByRole('button', { name: 'common.operation.play' }).click()
  await expect.poll(() => video.paused).toBe(false)
  await expect.element(screen.getByRole('button', { name: 'common.operation.pause' })).toBeVisible()
})
