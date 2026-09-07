import type { PostAgentByAgentIdAudioToTextData } from '@dify/contracts/api/console/agent/types.gen'
import type { AppSourceType } from '@/service/share'

type AgentSpeechToTextDraftType = NonNullable<
  PostAgentByAgentIdAudioToTextData['body']['draft_type']
>

export type SpeechToTextTarget =
  | {
      type: 'app'
      appId?: string
      appSourceType: AppSourceType.webApp
    }
  | {
      type: 'app'
      appId: string
      appSourceType: Exclude<AppSourceType, AppSourceType.webApp>
    }
  | {
      type: 'consoleApp'
      appId: string
    }
  | {
      type: 'agent'
      agentId: string
      draftType: AgentSpeechToTextDraftType
    }
