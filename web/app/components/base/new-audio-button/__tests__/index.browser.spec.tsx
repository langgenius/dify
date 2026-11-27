import { page, userEvent } from 'vite-plus/test/browser'
import { installFakeApi, route } from '@/test/fake-api'
import {
  audioResponse,
  audioRoutes,
  createNativePlayer,
  destroyPlayer,
  renderAudio,
} from '../../audio-btn/__tests__/audio-browser-test-env'
import AudioBtn from '../index'

const api = {
  stream: vi.fn<(url: string, source: string, body: unknown) => Response | Promise<Response>>(),
}
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

it.each(audioRoutes)(
  'plays the answer through the $route endpoint with the requested voice',
  async ({ params, pathname, url, source, route }) => {
    api.stream.mockResolvedValue(audioResponse())
    const id = `new-route-${route}`
    onTestFinished(() => destroyPlayer(id))
    const screen = await renderAudio(<AudioBtn id={id} value="Read this answer" voice="alloy" />, {
      params,
      pathname,
    })
    const play = screen.getByRole('button', { name: 'Play', exact: true })
    await play.hover()
    await expect.element(screen.getByText('Play', { exact: true })).toBeVisible()
    await play.click()
    await expect.element(screen.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
    await expect
      .poll(() => api.stream)
      .toHaveBeenCalledExactlyOnceWith(url, source, {
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
