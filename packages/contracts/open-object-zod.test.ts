import { describe, expect, it } from 'vite-plus/test'
import { zWorkflowGraphResponse } from './generated/api/console/apps/zod.gen.ts'

describe('open object schemas', () => {
  it.each([
    { id: 'start', type: 'start' },
    { id: 'start', data: { title: 'Start', variables: [] } },
    { id: 'start', data: null },
    { id: 'start', data: { type: null } },
  ])('keeps sparse stored nodes unchanged: %o', (node) => {
    const graph = { nodes: [node], edges: [] }

    expect(zWorkflowGraphResponse.parse(graph)).toEqual(graph)
  })

  // Stored graphs carry node-specific settings beyond the documented keys; validating a
  // response must not strip them, or a later draft sync would write them back without.
  it('keeps keys outside the declared properties', () => {
    const graph = {
      nodes: [
        {
          id: 'agent',
          width: 244,
          data: { type: 'agent-v2', title: 'Agent', agent_output_routes: { enabled: true } },
        },
      ],
      edges: [],
    }

    expect(zWorkflowGraphResponse.parse(graph)).toEqual(graph)
  })
})
