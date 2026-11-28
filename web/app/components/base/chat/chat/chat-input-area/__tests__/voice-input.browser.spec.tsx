import type { VoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { startVoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { TEST_APP_ID } from '@/test/console/ids'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import ChatInputArea from '../index'

// boundary: microphone capture and MP3 encoding are outside the composer's focus contract.
vi.mock('@/app/components/base/voice-input/recorder', () => ({ startVoiceRecorder: vi.fn() }))

const fake = setupFakeApi({
  console: {
    apps: {
      byAppId: {
        audioToText: {
          post: () => {
            throw apiError({ status: 500, message: 'API error' })
          },
        },
      },
    },
  },
})

afterEach(() => toast.dismiss())

it('preserves the draft, reports transcription failure, and returns focus to the microphone', async () => {
  // Chromium supplies textarea layout, pointer focus, and focus loss when the stop button unmounts.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const audioContext = new AudioContext()
  const recorder: VoiceRecorder = {
    analyser: audioContext.createAnalyser(),
    stop: vi.fn().mockResolvedValue(new Blob(['mp3-data'], { type: 'audio/mp3' })),
    cancel: vi.fn().mockResolvedValue(undefined),
  }
  vi.mocked(startVoiceRecorder).mockResolvedValue(recorder)
  const { NavigationProvider } = createTestNavigation()
  try {
    const screen = await render(
      <NavigationProvider>
        <QueryClientProvider client={queryClient}>
          <AppToaster timeout={0} />
          <div className="w-96">
            <ChatInputArea
              inputLabel="Message"
              speechToTextConfig={{ enabled: true }}
              speechToTextTarget={{ type: 'consoleApp', appId: TEST_APP_ID }}
            />
          </div>
        </QueryClientProvider>
      </NavigationProvider>,
    )
    const input = screen.getByRole('textbox', { name: 'Message' })
    await input.fill('Keep this text')
    const microphone = screen.getByRole('button', { name: 'common.voiceInput.start' })
    await microphone.click()
    await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()

    // An uncataloged code shows the translated fallback instead of the server's English text.
    await expect
      .element(screen.getByRole('dialog', { name: 'common.api.actionFailed' }))
      .toBeVisible()
    expect(fake.console.apps.byAppId.audioToText.post).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: TEST_APP_ID },
      body: { file: expect.any(File) },
    })
    await expect.element(input).toHaveValue('Keep this text')
    await expect.element(microphone).toHaveFocus()
  } finally {
    await audioContext.close()
    queryClient.clear()
  }
})
