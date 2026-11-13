import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { createWavFixture } from '@/test/browser-media'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TtsAutoPlay } from '@/types/app'
import { renderFeature } from '../../__tests__/feature-browser-test-env'
import VoiceSettings from '../voice-settings'

const api = vi.hoisted(() => ({
  app: vi.fn(),
  agent: vi.fn(),
  audio: vi.fn(),
  params: {} as { appId?: string; agentId?: string },
}))
vi.unmock('react-i18next')
// boundary: route identity is supplied without bootstrapping Next routing.
vi.mock('@/next/navigation', () => ({
  useParams: () => api.params,
  usePathname: () => '/configuration',
}))
// boundary: generated Console voice-catalog requests remain below the real query owner.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.textToAudio.voices.get': (input) => api.app(input),
      'agent.byAgentId.textToAudio.voices.get': (input) => api.agent(input),
    }),
  }
})
// boundary: audio bytes replace the text-to-audio HTTP stream; playback remains native.
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  textToAudioStream: (...args: unknown[]) => api.audio(...args),
}))

beforeEach(async () => {
  await page.viewport(1100, 800)
  onTestFinished(guardUnexpectedFetch())
  api.params = { appId: 'test-app-id' }
  api.app.mockResolvedValue([
    { name: 'Alloy', value: 'alloy' },
    { name: 'Echo', value: 'echo' },
  ])
  api.agent.mockResolvedValue([
    { name: 'Alloy', value: 'alloy' },
    { name: 'Echo', value: 'echo' },
  ])
})

function Settings({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <VoiceSettings
      open={open}
      onOpen={setOpen}
      disabled={disabled}
      trigger={<button type="button">Settings</button>}
    />
  )
}

it.each(['app', 'agent'] as const)(
  'loads %s voices and keeps native keyboard selections and autoplay across reopening',
  async (route) => {
    api.params = route === 'app' ? { appId: 'test-app-id' } : { agentId: 'test-agent-id' }
    const { screen, store } = await renderFeature(<Settings />, {
      text2speech: {
        enabled: true,
        language: 'en-US',
        voice: 'alloy',
        autoPlay: TtsAutoPlay.disabled,
      },
    })
    const trigger = screen.getByRole('button', { name: 'Settings', exact: true })
    await trigger.click()
    const voice = screen.getByRole('combobox', { name: 'Voice', exact: true })
    await expect.element(voice).toHaveTextContent('Alloy')
    expect(api[route]).toHaveBeenCalledWith({
      params: route === 'app' ? { app_id: 'test-app-id' } : { agent_id: 'test-agent-id' },
      query: { language: 'en-US' },
    })
    await voice.click()
    await expect.element(screen.getByRole('option', { name: 'Alloy', exact: true })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(screen.getByRole('option', { name: 'Echo', exact: true })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(voice).toHaveTextContent('Echo')
    await expect.element(voice).toHaveFocus()
    expect(store.getState().features.text2speech?.voice).toBe('echo')
    await screen.getByRole('switch').click()
    await expect.element(screen.getByRole('switch')).toBeChecked()
    expect(store.getState().features.text2speech?.autoPlay).toBe(TtsAutoPlay.enabled)
    await screen.getByRole('combobox', { name: 'Language', exact: true }).click()
    await screen.getByRole('option', { name: 'Chinese', exact: true }).click()
    await expect
      .element(screen.getByRole('combobox', { name: 'Language', exact: true }))
      .toHaveTextContent('Chinese')
    expect(api[route]).toHaveBeenCalledWith({
      params: route === 'app' ? { app_id: 'test-app-id' } : { agent_id: 'test-agent-id' },
      query: { language: 'zh-Hans' },
    })
    await screen.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByRole('combobox', { name: 'Voice', exact: true }))
      .toHaveTextContent('Echo')
    await expect.element(screen.getByRole('switch')).toBeChecked()
    await screen.getByRole('switch').click()
    await expect.element(screen.getByRole('switch')).not.toBeChecked()
    expect(store.getState().features.text2speech?.autoPlay).toBe(TtsAutoPlay.disabled)
  },
)

it('auditions the displayed fallback voice with the real language catalog and native audio', async () => {
  api.params = { agentId: 'agent-1' }
  const wav = createWavFixture({ duration: 10 })
  onTestFinished(wav.revoke)
  api.audio.mockResolvedValue(
    new Response(Uint8Array.from(wav.bytes), { headers: { 'content-type': 'audio/wav' } }),
  )
  const { screen } = await renderFeature(<Settings />, {
    text2speech: { enabled: true, language: '', voice: 'removed-voice' },
  })
  await screen.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect
    .element(screen.getByRole('combobox', { name: 'Language', exact: true }))
    .toHaveTextContent('English')
  await expect
    .element(screen.getByRole('combobox', { name: 'Voice', exact: true }))
    .toHaveTextContent('Alloy')
  await screen.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.element(screen.getByRole('button', { name: 'Playing', exact: true })).toBeEnabled()
  expect(api.audio).toHaveBeenCalledWith('/agent/agent-1/text-to-audio', 'installedApp', {
    message_id: undefined,
    streaming: true,
    voice: 'alloy',
    text: 'Hello, Dify!',
  })
  await screen.getByRole('button', { name: 'Playing', exact: true }).click()
  await expect.element(screen.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
})

it('keeps voices unloaded without a route identity and honors a disabled settings trigger', async () => {
  api.params = {}
  const { screen, rerender } = await renderFeature(<Settings />, { text2speech: { enabled: true } })
  const trigger = screen.getByRole('button', { name: 'Settings', exact: true })
  await trigger.click()
  await expect
    .element(screen.getByRole('combobox', { name: 'Voice', exact: true }))
    .toHaveTextContent('Please select')
  expect(api.app).not.toHaveBeenCalled()
  expect(api.agent).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await rerender(<Settings disabled />)
  await expect.element(trigger).toBeDisabled()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})
