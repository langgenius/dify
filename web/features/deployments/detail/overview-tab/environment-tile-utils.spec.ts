import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from './environment-tile-utils'

describe('resolveConfig', () => {
  it('treats undeploying environments as in progress', () => {
    const config = resolveConfig({
      drift: { kind: 'up-to-date' },
      status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
      hasAnyRelease: true,
      latestId: 'release-2',
      currentReleaseId: 'release-1',
    })

    expect(config.kind).toBe('deploying')
    expect(config.status).toBe(RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING)
    expect(config.intent).toBe('navigate')
  })
})
