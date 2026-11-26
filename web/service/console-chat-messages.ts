import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { ConsoleClientContext } from './console'
import type { StreamSender } from './event-stream'
import { createORPCClient } from '@orpc/client'
import { oc, type } from '@orpc/contract'
import { createBrowserLink } from './console/browser'

// The generated Console contract only has the GET (history) routes for these paths: the backend
// registers the POST on a second Flask-RESTX Resource with the same URL, which the OpenAPI spec
// drops. Declare the two streaming POST routes here until the spec documents them.
type ChatMessageBody = Record<string, unknown>

const chatMessagesPost = oc.$route({ inputStructure: 'detailed', method: 'POST' })

const consoleChatMessagesContract = {
  app: chatMessagesPost
    .route({ path: '/apps/{app_id}/chat-messages' })
    .input(type<{ params: { app_id: string }; body: ChatMessageBody }>()),
  agent: chatMessagesPost
    .route({ path: '/agent/{agent_id}/chat-messages' })
    .input(type<{ params: { agent_id: string }; body: ChatMessageBody }>()),
}

const consoleChatMessagesClient: JsonifiedClient<
  ContractRouterClient<typeof consoleChatMessagesContract, ConsoleClientContext>
> = createORPCClient(createBrowserLink(consoleChatMessagesContract))

/** Streams a debug chat message for a Console app. */
export const appChatMessagesSender =
  (appId: string): StreamSender =>
  (body, options) =>
    consoleChatMessagesClient.app({ params: { app_id: appId }, body }, options)

/** Streams a preview chat message for an Agent App. */
export const agentChatMessagesSender =
  (agentId: string): StreamSender =>
  (body, options) =>
    consoleChatMessagesClient.agent({ params: { agent_id: agentId }, body }, options)
