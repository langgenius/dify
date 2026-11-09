import type { AgentSoulModelConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentChatMessageSender } from './chat-conversation'

/**
 * Sends Build chat turns. A Build model, when chosen, runs only this request;
 * omitting it keeps the turn on the Agent model.
 */
export function createBuildChatMessageSender(
  buildModel?: AgentSoulModelConfig,
): AgentChatMessageSender {
  return ({ agentId, callbacks, data, handleSend }) =>
    handleSend(
      `agent/${agentId}/chat-messages`,
      buildModel ? { ...data, build_model: buildModel } : data,
      callbacks,
    )
}
