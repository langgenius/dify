import {
  getExternalAgentInvocationId,
  hasExternalWaitReason,
  hasHumanInputWaitReason,
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
