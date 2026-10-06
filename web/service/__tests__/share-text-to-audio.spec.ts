import { consoleClient } from '@/service/console'
import { AppSourceType, textToAudioStream } from '../share'

vi.mock('@/service/console', () => ({
  consoleClient: {
    agent: { byAgentId: { textToAudio: { post: vi.fn() } } },
  },
}))

describe('Agent text-to-audio transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adapts generated audio downloads to the shared player response contract', async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0xff])
    vi.mocked(consoleClient.agent.byAgentId.textToAudio.post).mockResolvedValue(
      new Blob([bytes], { type: 'audio/wav' }),
    )

    const response = await textToAudioStream(
      '/agent/agent-1/text-to-audio',
      AppSourceType.installedApp,
      {
        text: 'Preview this voice',
        voice: 'echo',
        streaming: true,
      },
    )

    expect(consoleClient.agent.byAgentId.textToAudio.post).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      body: { text: 'Preview this voice', voice: 'echo', streaming: true },
    })
    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('content-type')).toBe('audio/wav')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  it('propagates failed synthesis to the player', async () => {
    const failure = new Error('No TTS model is configured')
    vi.mocked(consoleClient.agent.byAgentId.textToAudio.post).mockRejectedValue(failure)

    await expect(
      textToAudioStream('/agent/agent-1/text-to-audio', AppSourceType.installedApp, {
        text: 'Preview this voice',
        streaming: true,
      }),
    ).rejects.toBe(failure)
  })
})
