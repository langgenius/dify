import type { OpenUiStatePayload as OpenUIStatePayload } from '@dify/contracts/api/console/agent/types.gen'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- The generated public contract needs the existing webapp auth and environment transport.
import { request } from '@/service/base'
import { consoleClient } from '@/service/console'
import { getWebAppPublicApiPath, resolveWebAppAddress } from '@/service/webapp-address'

export type GenerativeUIStateTarget =
  | { kind: 'app'; appId: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'installed-app'; installedAppId: string }
  | { kind: 'webapp' }

export async function saveGenerativeUIState(
  target: GenerativeUIStateTarget,
  messageId: string,
  blockId: string,
  formState: OpenUIStatePayload['form_state'],
) {
  const params = { message_id: messageId, block_id: blockId }
  const body = { form_state: formState }
  switch (target.kind) {
    case 'app':
      return consoleClient.apps.byAppId.messages.byMessageId.contentBlocks.byBlockId.state.put({
        params: { ...params, app_id: target.appId },
        body,
      })
    case 'agent':
      return consoleClient.agent.byAgentId.messages.byMessageId.contentBlocks.byBlockId.state.put({
        params: { ...params, agent_id: target.agentId },
        body,
      })
    case 'installed-app':
      return consoleClient.installedApps.byInstalledAppId.messages.byMessageId.contentBlocks.byBlockId.state.put(
        {
          params: { ...params, installed_app_id: target.installedAppId },
          body,
        },
      )
    case 'webapp': {
      const { contract } = await import('@dify/contracts/api/web/orpc.gen')
      const stateContract = {
        save: contract.messages.byMessageId.contentBlocks.byBlockId.state.put,
      }
      const client: JsonifiedClient<ContractRouterClient<typeof stateContract>> = createORPCClient(
        new OpenAPILink(stateContract, {
          url: () =>
            new URL(
              PUBLIC_API_PREFIX + getWebAppPublicApiPath(resolveWebAppAddress(), ''),
              window.location.origin,
            ),
          fetch: (input, init) =>
            // oxlint-disable-next-line typescript/no-deprecated -- Adapt the generated public endpoint to the authenticated webapp transport.
            request<Response>(input.url, init, {
              isPublicAPI: true,
              fetchCompat: true,
              request: input,
            }),
        }),
      )
      return client.save({ params, body })
    }
  }
}
