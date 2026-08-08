import { zSupportedAppType } from '@dify/contracts/api/openapi/zod.gen'
import { describe, expect, it } from 'vitest'

// The `get app --mode` whitelist is derived from this generated enum (see index.ts).
// These pins guard the original bug: the CLI must not advertise modes the backend
// rejects (rag-pipeline, channel) or modes that aren't listable here (agent).
describe('get app --mode whitelist', () => {
  it('is exactly the listable app types', () => {
    expect([...zSupportedAppType.options].sort()).toEqual([
      'advanced-chat',
      'agent-chat',
      'chat',
      'completion',
      'workflow',
    ])
  })
})
