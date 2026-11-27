import type { SpeechToTextTarget } from './types'
import { audioToText } from '@/service/share'

export async function transcribeAudio(
  target: SpeechToTextTarget,
  file: File,
  signal?: AbortSignal,
): Promise<{ text: string }> {
  if (target.type === 'agent' || target.type === 'consoleApp') {
    const { consoleClient } = await import('@/service/console')
    if (target.type === 'agent') {
      return consoleClient.agent.byAgentId.audioToText.post(
        {
          body: {
            draft_type: target.draftType,
            file,
          },
          params: {
            agent_id: target.agentId,
          },
        },
        { signal },
      )
    }
    return consoleClient.apps.byAppId.audioToText.post(
      {
        body: { file },
        params: { app_id: target.appId },
      },
      { signal },
    )
  }

  return audioToText(target.appSourceType, target.appId, file, signal)
}
