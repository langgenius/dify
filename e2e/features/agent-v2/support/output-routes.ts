import type { SyncDraftWorkflowPayload } from '@dify/contracts/api/console/apps/types.gen'

export const agentOutputRoutes = [
  { id: 'accepted', label: 'Accepted', name: 'The request is accepted.' },
  { id: 'rejected', label: 'Rejected', name: 'The request is rejected.' },
]

export function createRoutedAgentNode(agentId: string) {
  return {
    id: 'agent-v2',
    type: 'custom',
    position: { x: 400, y: 180 },
    data: {
      id: 'agent-v2',
      type: 'agent',
      title: 'Agent',
      desc: '',
      agent_binding: { binding_type: 'roster_agent', agent_id: agentId },
      agent_node_kind: 'dify_agent',
      version: '2',
      agent_task: 'Decide whether the request is accepted or rejected.',
      agent_output_routes: { enabled: true, routes: agentOutputRoutes },
    },
  }
}

export function createRoutedAgentWorkflowDraft(agentId: string): SyncDraftWorkflowPayload {
  const agent = createRoutedAgentNode(agentId)
  const destinations = [
    ...agentOutputRoutes.map((route) => ({ id: route.id, title: route.label })),
    { id: 'fail-branch', title: 'Failure' },
  ]

  return {
    graph: {
      nodes: [
        {
          id: 'start',
          type: 'custom',
          position: { x: 50, y: 180 },
          data: { id: 'start', type: 'start', title: 'Start', variables: [] },
        },
        { ...agent, data: { ...agent.data, error_strategy: 'fail-branch' } },
        ...destinations.map((destination, index) => ({
          id: `${destination.id}-end`,
          type: 'custom',
          position: { x: 800, y: 50 + index * 190 },
          data: {
            id: `${destination.id}-end`,
            type: 'end',
            title: `${destination.title} result`,
            outputs: [],
          },
        })),
      ],
      edges: [
        {
          id: 'start-agent',
          type: 'custom',
          source: 'start',
          target: agent.id,
          sourceHandle: 'source',
          targetHandle: 'target',
          data: { sourceType: 'start', targetType: 'agent' },
        },
        ...destinations.map((destination) => ({
          id: `agent-${destination.id}`,
          type: 'custom',
          source: agent.id,
          target: `${destination.id}-end`,
          sourceHandle: destination.id,
          targetHandle: 'target',
          data: { sourceType: 'agent', targetType: 'end' },
        })),
      ],
      viewport: { x: 40, y: 40, zoom: 0.7 },
    },
    features: {},
    conversation_variables: [],
  }
}
