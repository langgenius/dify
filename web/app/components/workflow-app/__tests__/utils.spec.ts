import { buildTriggerStatusMap, coerceReplayUserInputs } from '../utils'

describe('workflow-app utils', () => {
  it('should map trigger statuses to enabled and disabled states', () => {
    expect(
      buildTriggerStatusMap([
        { node_id: 'node-1', status: 'enabled' },
        { node_id: 'node-2', status: 'disabled' },
        { node_id: 'node-3', status: 'paused' },
      ]),
    ).toEqual({
      'node-1': 'enabled',
      'node-2': 'disabled',
      'node-3': 'disabled',
    })
  })

  it('should coerce replay run inputs, omit sys keys, and stringify complex values', () => {
    expect(
      coerceReplayUserInputs({
        'sys.query': 'hidden',
        query: 'hello',
        count: 3,
        enabled: true,
        nullable: null,
        metadata: { nested: true },
      }),
    ).toEqual({
      query: 'hello',
      count: 3,
      enabled: true,
      nullable: '',
      metadata: '{"nested":true}',
    })
    expect(coerceReplayUserInputs('invalid')).toBeNull()
    expect(coerceReplayUserInputs(null)).toBeNull()
  })
})
