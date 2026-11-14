import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { AudioBtn } from '../index'
import {
  audioResponse,
  audioRoutes,
  createNativePlayer,
  destroyPlayer,
  renderAudio,
} from './audio-browser-test-env'

const api = vi.hoisted(() => ({
  stream: vi.fn(),
  params: {} as Record<string, string>,
  pathname: '/',
}))
vi.unmock('react-i18next')
// boundary: supply route identity without the Next runtime.
vi.mock('@/next/navigation', () => ({
  useParams: () => api.params,
  usePathname: () => api.pathname,
}))
// boundary: only the text-to-audio HTTP response is replaced; manager and media engine stay real.
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

it.each([
  ...audioRoutes,
  {
    route: 'agent audition',
    params: { agentId: 'agent-1' },
    pathname: '/agents/agent-1/configure',
    url: '/agent/agent-1/text-to-audio',
    source: 'installedApp',
  },
])(
  'plays the selected voice through the $route HTTP endpoint',
  async ({ params, pathname, url, source, route }) => {
    api.params = params
    api.pathname = pathname
    api.stream.mockResolvedValue(audioResponse())
    const id = `route-${route}`
    onTestFinished(() => destroyPlayer(id))
    const screen = await renderAudio(
      <AudioBtn
        id={id}
        value="Read this answer"
        voice="alloy"
        isAudition={route === 'agent audition'}
      />,
    )
    await screen.getByRole('button', { name: 'Play', exact: true }).click()
    await expect.element(screen.getByRole('button', { name: 'Playing', exact: true })).toBeEnabled()
    expect(api.stream).toHaveBeenCalledExactlyOnceWith(url, source, {
      message_id: id,
      streaming: true,
      voice: 'alloy',
      text: 'Read this answer',
    })
  },
)

it('plays and pauses native audio, then reuses the cached recording through its end', async () => {
  const id = 'playback'
  const player = createNativePlayer(id)
  onTestFinished(() => player.destroy())
  api.stream.mockResolvedValue(audioResponse())
  const screen = await renderAudio(<AudioBtn id={id} value="Read this answer" voice="alloy" />)
  await screen.getByRole('button', { name: 'Play', exact: true }).click()
  const playing = screen.getByRole('button', { name: 'Playing', exact: true })
  await expect.element(playing).toBeEnabled()
  await expect.poll(() => player.audio.paused).toBe(false)
  await expect.poll(() => player.audio.currentTime).toBeGreaterThan(0)
  expect(player.audio.currentSrc).toMatch(/^blob:/)
  await playing.click()
  await expect.element(screen.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  await expect.poll(() => player.audio.paused).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(playing).toBeEnabled()
  await expect.poll(() => player.audio.paused).toBe(false)
  expect(api.stream).toHaveBeenCalledTimes(1)
  player.audio.currentTime = player.audio.duration - 0.05
  await expect.poll(() => player.audio.ended).toBe(true)
  await expect.element(screen.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
})

it('returns from a failed HTTP load to an operable Play action and retries', async () => {
  const id = 'failed-load'
  onTestFinished(() => destroyPlayer(id))
  api.stream
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockImplementationOnce(async () => audioResponse())
  const screen = await renderAudio(<AudioBtn id={id} value="Read this answer" />)
  const play = screen.getByRole('button', { name: 'Play', exact: true })
  await play.click()
  await expect.element(play).toBeEnabled()
  await play.click()
  await expect.element(screen.getByRole('button', { name: 'Playing', exact: true })).toBeEnabled()
})

it('keeps a synchronous cached-play notification when another control takes over the same message', async () => {
  const id = 'shared-playback'
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
        .getByRole('button', { name: 'Playing', exact: true }),
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
        .getByRole('button', { name: 'Playing', exact: true }),
    )
    .toBeEnabled()
  expect(player.audio.paused).toBe(false)
  expect(api.stream).toHaveBeenCalledTimes(1)
})
