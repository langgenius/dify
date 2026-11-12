import type { consoleClient } from '@/service/console'
import { ORPCError } from '@orpc/client'
import {
  createExternalAgentAsset,
  createExternalAgentCapabilities,
  createExternalAgentDetail,
} from '@/test/console/external-agents'

export const workflowExternalAgents = [
  createExternalAgentAsset(),
  createExternalAgentAsset({
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Document Review Agent',
    role: 'Document review',
  }),
  createExternalAgentAsset({
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Invoice Audit Agent',
    enabled: false,
  }),
]

export function createWorkflowExternalResponses() {
  return {
    'externalAgents.byAgentId.references.get': () => ({ apps: [], may_have_in_flight: false }),
    'workspaces.current.members.get': () => ({ accounts: [] }),
    'externalAgents.capabilities.get': () => createExternalAgentCapabilities(),
    'externalAgents.get': (input: Parameters<typeof consoleClient.externalAgents.get>[0]) => {
      const items = workflowExternalAgents.filter(
        (agent) =>
          !input?.query?.keyword ||
          agent.name.toLowerCase().includes(input.query.keyword.toLowerCase()),
      )
      return {
        items,
        total: items.length,
        limit: input?.query?.limit ?? 20,
        page: input?.query?.page ?? 1,
      }
    },
    'externalAgents.byAgentId.get': (
      input: Parameters<typeof consoleClient.externalAgents.byAgentId.get>[0],
    ) => {
      const asset = workflowExternalAgents.find((agent) => agent.id === input.params.agent_id)
      if (!asset) throw new ORPCError('NOT_FOUND')
      const detail = createExternalAgentDetail({ asset })
      if (asset.id === workflowExternalAgents[1]!.id) {
        detail.connection = {
          ...detail.connection,
          endpoint: 'https://agents.example.test/document',
          card: {
            name: asset.name,
            defaultInputModes: ['text/plain', 'application/pdf'],
            defaultOutputModes: ['text/plain'],
            skills: [
              {
                id: 'document-review',
                name: 'Document review',
                description: 'Review information in documents.',
                tags: ['Documents'],
                examples: [
                  'Review this document and summarize the information that needs attention.',
                ],
              },
            ],
          },
        }
      }
      return detail
    },
    'apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get': () => {
      throw new ORPCError('NOT_FOUND')
    },
  }
}
