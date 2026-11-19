import {
  getExternalAgentInvocationId,
  hasExternalWaitReason,
  hasHumanInputWaitReason,
  isExternalWaitExecution,
  isExternalWaitOnly,
} from '../execution'

it('resolves the production and node-debug invocation references without treating native logs as A2A traces', () => {
  expect(
    getExternalAgentInvocationId({ process_data: { external_invocation_id: 'direct-id' } }),
  ).toBe('direct-id')
  expect(
    getExternalAgentInvocationId({
      process_data: JSON.stringify({ external_invocation_id: 'json-id' }),
    }),
  ).toBe('json-id')
  expect(
    getExternalAgentInvocationId({
      execution_metadata: { agent_log: { invocation_id: 'metadata-id' } },
    }),
  ).toBe('metadata-id')
  expect(
    getExternalAgentInvocationId({ execution_metadata: { agent_log: [{ message_id: 'native' }] } }),
  ).toBeUndefined()
})

it('distinguishes engine external waits from both human input reason versions and mixed pauses', () => {
  expect(hasExternalWaitReason([{ TYPE: 'external_wait' }])).toBe(true)
  expect(hasHumanInputWaitReason([{ TYPE: 'external_wait' }])).toBe(false)
  expect(hasHumanInputWaitReason([{ TYPE: 'hitl_required' }])).toBe(true)
  expect(hasHumanInputWaitReason([{ TYPE: 'human_input_required' }])).toBe(true)
  expect(hasExternalWaitReason([{ TYPE: 'hitl_required' }, { TYPE: 'external_wait' }])).toBe(true)
})

it('requires a nonempty set of only external waits before displaying a paused workflow as running', () => {
  expect(isExternalWaitOnly([{ TYPE: 'external_wait' }])).toBe(true)
  expect(isExternalWaitOnly([{ TYPE: 'external_wait' }, { TYPE: 'external_wait' }])).toBe(true)
  expect(isExternalWaitOnly([{ TYPE: 'external_wait' }, { TYPE: 'human_input_required' }])).toBe(
    false,
  )
  expect(isExternalWaitOnly([{ TYPE: 'external_wait' }, { TYPE: 'scheduled' }])).toBe(false)
  expect(isExternalWaitOnly([])).toBe(false)
  expect(isExternalWaitOnly(undefined)).toBe(false)
})

it('identifies the waiting execution without matching another loop execution of the same node', () => {
  const reasons = [{ TYPE: 'external_wait', node_id: 'agent', execution_id: 'execution-2' }]
  expect(isExternalWaitExecution(reasons, 'execution-2')).toBe(true)
  expect(isExternalWaitExecution(reasons, 'execution-1')).toBe(false)
  expect(isExternalWaitExecution(reasons, 'live-event', 'execution-2')).toBe(true)
  expect(
    isExternalWaitExecution(
      [...reasons, { TYPE: 'scheduled', execution_id: 'execution-2' }],
      'execution-2',
    ),
  ).toBe(false)
})
