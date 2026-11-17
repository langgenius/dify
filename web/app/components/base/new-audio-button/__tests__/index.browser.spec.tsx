import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  audioResponse,
  audioRoutes,
  createNativePlayer,
  destroyPlayer,
  renderAudio,
} from '../../audio-btn/__tests__/audio-browser-test-env'
import AudioBtn from '../index'

const api = vi.hoisted(() => ({
  stream: vi.fn(),
  params: {} as Record<string, string>,
  pathname: '/',
}))
vi.unmock('react-i18next')
// boundary: supply route identity without bootstrapping Next.
vi.mock('@/next/navigation', () => ({
  useParams: () => api.params,
  usePathname: () => api.pathname,
}))
// boundary: return HTTP audio bytes below the real player manager and native media engine.
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  textToAudioStream: (...args: unknown[]) => api.stream(...args),
}))

beforeEach(async () => {
  await page.viewport(800, 600)
  api.params = { appId: 'app-1' }
  api.pathname = '/apps/app-1/chat'
  api.stream.mockReset()
  onTestFinished(guardUnexpectedFetch())
})

it.each(audioRoutes)(
  'plays the answer through the $route endpoint with the requested voice',
  async ({ params, pathname, url, source, route }) => {
    api.params = params
    api.pathname = pathname
    api.stream.mockResolvedValue(audioResponse())
    const id = `new-route-${route}`
    onTestFinished(() => destroyPlayer(id))
    const screen = await renderAudio(<AudioBtn id={id} value="Read this answer" voice="alloy" />)
    const play = screen.getByRole('button', { name: 'Play', exact: true })
    await play.hover()
    await expect.element(screen.getByText('Play', { exact: true })).toBeVisible()
    await play.click()
    await expect.element(screen.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
    expect(api.stream).toHaveBeenCalledExactlyOnceWith(url, source, {
      message_id: id,
      streaming: true,
      text: 'Read this answer',
      voice: 'alloy',
    })
  },
)

it('pauses and resumes the native recording, then exposes Play when it ends', async () => {
  const id = 'new-playback'
  const player = createNativePlayer(id)
  onTestFinished(() => player.destroy())
  api.stream.mockResolvedValue(audioResponse())
  const screen = await renderAudio(<AudioBtn id={id} value="Read this answer" voice="alloy" />)
  await screen.getByRole('button', { name: 'Play', exact: true }).click()
  const pause = screen.getByRole('button', { name: 'Pause', exact: true })
  await expect.element(pause).toBeEnabled()
  await expect.poll(() => player.audio.paused).toBe(false)
  await expect.poll(() => player.audio.currentTime).toBeGreaterThan(0)
  expect(player.audio.currentSrc).toMatch(/^blob:/)
  await pause.click()
  await expect.element(screen.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  await expect.poll(() => player.audio.paused).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(pause).toBeEnabled()
  await expect.poll(() => player.audio.paused).toBe(false)
  expect(api.stream).toHaveBeenCalledTimes(1)
  player.audio.currentTime = player.audio.duration - 0.05
  await expect.poll(() => player.audio.ended).toBe(true)
  await expect.element(screen.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
})

it('recovers from a failed audio response and retries from the keyboard', async () => {
  const id = 'new-failed-load'
  onTestFinished(() => destroyPlayer(id))
  api.stream
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockImplementationOnce(async () => audioResponse())
  const screen = await renderAudio(<AudioBtn id={id} value="Read this answer" />)
  const play = screen.getByRole('button', { name: 'Play', exact: true })
  await play.click()
  await expect.element(play).toBeEnabled()
  await expect.element(play).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
})

it('preserves the synchronous play state when another control reuses the playing message', async () => {
  const id = 'new-shared-playback'
  const player = createNativePlayer(id)
  onTestFinished(() => player.destroy())
  api.stream.mockResolvedValue(audioResponse())
  const screen = await renderAudio(
    <>
      <section aria-label="First control">
        <AudioBtn id={id} value="Read this answer" />
      </section>
      <section aria-label="Second control">
        <AudioBtn id={id} value="Read this answer" />
      </section>
    </>,
  )
  await screen
    .getByRole('region', { name: 'First control' })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  await expect
    .element(
      screen
        .getByRole('region', { name: 'First control' })
        .getByRole('button', { name: 'Pause', exact: true }),
    )
    .toBeEnabled()
  await expect.poll(() => player.audio.paused).toBe(false)
  await screen
    .getByRole('region', { name: 'Second control' })
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  await expect
    .element(
      screen
        .getByRole('region', { name: 'Second control' })
        .getByRole('button', { name: 'Pause', exact: true }),
    )
    .toBeEnabled()
  expect(player.audio.paused).toBe(false)
  expect(api.stream).toHaveBeenCalledTimes(1)
})
