import { page, userEvent } from 'vite-plus/test/browser'
import { installFakeApi, route } from '@/test/fake-api'
import { AudioBtn } from '../index'
import {
  audioResponse,
  audioRoutes,
  createNativePlayer,
  destroyPlayer,
  renderAudio,
} from './audio-browser-test-env'

const api = {
  stream: vi.fn<(url: string, source: string, body: unknown) => Response | Promise<Response>>(),
}
// The agent contract requires a UUID agent id.
const agentId = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f'
vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(800, 600)
  api.stream.mockReset()
  // Public web apps call the public API; console routes stand for installed-app sources.
  const respond =
    (source: string) =>
    async ({ request, url }: { request: Request; url: URL }) =>
      api.stream(url.pathname.replace(/^.*\/api/, ''), source, await request.json())
  onTestFinished(
    installFakeApi({
      console: {
        agent: {
          byAgentId: {
            textToAudio: {
              post: async ({ params, body }) => {
                const audio = await api.stream(
                  `/agent/${params.agent_id}/text-to-audio`,
                  'installedApp',
                  body,
                )
                return audio.blob()
              },
            },
          },
        },
      },
      routes: [
        route('POST', 'public', '/text-to-audio', respond('webApp')),
        route('POST', 'console', '/apps/:appId/text-to-audio', respond('installedApp')),
        route('POST', 'console', '/installed-apps/:appId/text-to-audio', respond('installedApp')),
      ],
    }),
  )
})

it.each([
  ...audioRoutes,
  {
    route: 'agent audition',
    params: { agentId },
    pathname: `/agents/${agentId}/configure`,
    url: `/agent/${agentId}/text-to-audio`,
    source: 'installedApp',
  },
])(
  'plays the selected voice through the $route HTTP endpoint',
  async ({ params, pathname, url, source, route }) => {
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
      { params, pathname },
    )
    await screen.getByRole('button', { name: 'Play', exact: true }).click()
    await expect.element(screen.getByRole('button', { name: 'Playing', exact: true })).toBeEnabled()
    await expect
      .poll(() => api.stream)
      .toHaveBeenCalledExactlyOnceWith(url, source, {
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
