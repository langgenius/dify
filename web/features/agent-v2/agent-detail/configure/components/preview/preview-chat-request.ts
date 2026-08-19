import type { AgentChatMessageRequest } from './chat-conversation'

export function sendPreviewChatMessage({
  agentId,
  callbacks,
  data,
  handleSend,
}: AgentChatMessageRequest) {
  return handleSend(`agent/${agentId}/chat-messages`, data, callbacks)
}
