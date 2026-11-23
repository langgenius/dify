import type { VoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { startVoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { toast } from '@/app/notifications'
import { TEST_APP_ID } from '@/test/console/ids'
import { apiError, setupFakeApi } from '@/test/fake-api'
import ChatInputArea from '../index'

// boundary: microphone capture and MP3 encoding are outside the composer's focus contract.
vi.mock('@/app/components/base/voice-input/recorder', () => ({ startVoiceRecorder: vi.fn() }))
// boundary: this component test has no running Next router.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))
// boundary: observe the application notification emitted after transcription fails.
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

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
  try {
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <div className="w-96">
          <ChatInputArea
            inputLabel="Message"
            speechToTextConfig={{ enabled: true }}
            speechToTextTarget={{ type: 'consoleApp', appId: TEST_APP_ID }}
          />
        </div>
      </QueryClientProvider>,
    )
    const input = screen.getByRole('textbox', { name: 'Message' })
    await input.fill('Keep this text')
    const microphone = screen.getByRole('button', { name: 'common.voiceInput.start' })
    await microphone.click()
    await screen.getByRole('button', { name: 'common.voiceInput.stop' }).click()

    await expect.poll(() => toast.error).toHaveBeenCalledWith('common.api.actionFailed')
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
