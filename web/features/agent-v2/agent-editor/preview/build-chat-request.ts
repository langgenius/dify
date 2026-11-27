import type { AgentChatMessageRequest } from './chat-conversation'
import { agentChatMessagesSender } from '@/service/console-chat-messages'

export function sendBuildChatMessage({
  agentId,
  callbacks,
  data,
  handleSend,
}: AgentChatMessageRequest) {
  return handleSend(agentChatMessagesSender(agentId), data, callbacks)
}
