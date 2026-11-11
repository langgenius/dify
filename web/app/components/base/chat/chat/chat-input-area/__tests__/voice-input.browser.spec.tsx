import type { VoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { transcribeAudio } from '@/app/components/base/voice-input/api'
import { startVoiceRecorder } from '@/app/components/base/voice-input/recorder'
import { toast } from '@/app/notifications'
import ChatInputArea from '../index'

// boundary: microphone capture and MP3 encoding are outside the composer's focus contract.
vi.mock('@/app/components/base/voice-input/recorder', () => ({ startVoiceRecorder: vi.fn() }))
// boundary: control the transcription service failure without making a network request.
vi.mock('@/app/components/base/voice-input/api', () => ({ transcribeAudio: vi.fn() }))
// boundary: this component test has no running Next router.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))
// boundary: observe the application notification emitted after transcription fails.
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

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
  vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('API error'))
  try {
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <div className="w-96">
          <ChatInputArea
            inputLabel="Message"
            speechToTextConfig={{ enabled: true }}
            speechToTextTarget={{ type: 'consoleApp', appId: 'app-123' }}
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
    await expect.element(input).toHaveValue('Keep this text')
    await expect.element(microphone).toHaveFocus()
  } finally {
    await audioContext.close()
    queryClient.clear()
  }
})
