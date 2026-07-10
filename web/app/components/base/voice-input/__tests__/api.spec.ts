import { consoleClient } from '@/service/client'
import { AppSourceType, audioToText } from '@/service/share'
import { transcribeAudio } from '../api'

vi.mock('@/service/share', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/service/share')>()
  return {
    ...original,
    audioToText: vi.fn(),
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    apps: {
      byAppId: {
        audioToText: {
          post: vi.fn(),
        },
      },
    },
    agent: {
      byAgentId: {
        audioToText: {
          post: vi.fn(),
        },
      },
    },
  },
}))

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // App surfaces retain their existing transport-specific endpoints.
  it('should send app audio through the existing app transport', async () => {
    const file = new File(['mp3'], 'temp.mp3', { type: 'audio/mp3' })
    vi.mocked(audioToText).mockResolvedValue({ text: 'app transcript' })

    const result = await transcribeAudio({
      type: 'app',
      appId: 'app-1',
      appSourceType: AppSourceType.installedApp,
    }, file)

    expect(result).toEqual({ text: 'app transcript' })
    const formData = vi.mocked(audioToText).mock.calls[0]![2]
    expect(audioToText).toHaveBeenCalledWith(AppSourceType.installedApp, 'app-1', formData)
    expect(formData.get('file')).toBe(file)
  })

  it('should send console App audio through its generated multipart contract', async () => {
    const file = new File(['mp3'], 'temp.mp3', { type: 'audio/mp3' })
    const post = consoleClient.apps.byAppId.audioToText.post
    vi.mocked(post).mockResolvedValue({ text: 'console app transcript' })

    const result = await transcribeAudio({ type: 'consoleApp', appId: 'app-1' }, file)

    expect(result).toEqual({ text: 'console app transcript' })
    expect(post).toHaveBeenCalledWith({
      body: { file },
      params: { app_id: 'app-1' },
    })
    expect(audioToText).not.toHaveBeenCalled()
  })

  // Agent debug audio uses its generated ID-first multipart contract.
  it('should send Agent audio with the requested draft type', async () => {
    const file = new File(['mp3'], 'temp.mp3', { type: 'audio/mp3' })
    const post = consoleClient.agent.byAgentId.audioToText.post
    vi.mocked(post).mockResolvedValue({ text: 'agent transcript' })

    const result = await transcribeAudio({
      type: 'agent',
      agentId: 'agent-1',
      draftType: 'debug_build',
    }, file)

    expect(result).toEqual({ text: 'agent transcript' })
    expect(post).toHaveBeenCalledWith({
      body: {
        draft_type: 'debug_build',
        file,
      },
      params: {
        agent_id: 'agent-1',
      },
    })
    expect(audioToText).not.toHaveBeenCalled()
  })
})
