import type { AgentChatMessageRequest } from './chat-conversation'

export function sendBuildChatMessage({
  agentId,
  callbacks,
  data,
  handleSend,
}: AgentChatMessageRequest) {
  return handleSend(`agent/${agentId}/chat-messages`, data, callbacks)
}
