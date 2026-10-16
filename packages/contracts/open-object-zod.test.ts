import { describe, expect, it } from 'vite-plus/test'
import { zWorkflowGraphResponse } from './generated/api/console/apps/zod.gen.ts'

describe('open object schemas', () => {
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
