import { describe, expect, it } from 'vitest'
import { sandbox as agentSandbox } from './generated/api/console/agent/orpc.gen'
import { sandbox as appSandbox } from './generated/api/console/apps/orpc.gen'

describe('generated sandbox contracts', () => {
  it.each([
    ['Agent sandbox', agentSandbox],
    ['App sandbox', appSandbox],
  ])('exposes the %s file operations', (_, sandbox) => {
    expect(sandbox.files.get).toBeDefined()
    expect(sandbox.files.read.get).toBeDefined()
    expect(sandbox.files.upload.post).toBeDefined()
  })
})
