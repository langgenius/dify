import type { InferContractRouterOutputs } from '@orpc/contract'
import type { apps } from './generated/api/console/apps/orpc.gen.ts'
import type { AgentToolCallResponse } from './generated/api/console/apps/types.gen.ts'
import { describe, expect, it } from 'vite-plus/test'
import { zAgentToolCallResponse } from './generated/api/console/apps/zod.gen.ts'

type AgentLogTool = InferContractRouterOutputs<
  typeof apps
>['byAppId']['agent']['logs']['get']['iterations'][number]['tool_calls'][number]

const tool = {
  status: 'success',
  error: null,
  time_cost: 0,
  tool_name: 'search',
  tool_label: { en_US: 'Search', zh_Hans: '搜索' },
  tool_icon: { background: '#fff', content: '🔍' },
  tool_input: { filters: [null, false, 0] },
  tool_output: 'No results',
  tool_parameters: { query: { default: '' } },
} satisfies AgentToolCallResponse

describe('generated agent log response contract', () => {
  it('preserves localized labels and every JSON output shape', () => {
    const outputs: AgentLogTool['tool_output'][] = [
      'Plain text',
      0,
      false,
      null,
      ['result', 1],
      { nested: [null, false, { count: 0 }] },
    ]
    for (const tool_output of outputs) {
      const response: AgentLogTool = { ...tool, tool_output }
      expect(zAgentToolCallResponse.parse(response)).toEqual(response)
    }
    const response: AgentLogTool = { ...tool, tool_label: 'search', tool_icon: '' }
    expect(zAgentToolCallResponse.parse(response)).toEqual(response)
  })

  it('rejects non-JSON values in both generated types and runtime schemas', () => {
    // @ts-expect-error Generated response types must reject functions nested inside JSON.
    const invalidType: AgentToolCallResponse['tool_output'] = { nested: { callback: () => true } }
    // @ts-expect-error oRPC derives its output type from Zod and must retain the same constraint.
    const invalidClient: AgentLogTool['tool_output'] = { nested: { callback: () => true } }
    for (const tool_output of [invalidType, invalidClient]) {
      expect(zAgentToolCallResponse.safeParse({ ...tool, tool_output }).success).toBe(false)
    }
  })
})
