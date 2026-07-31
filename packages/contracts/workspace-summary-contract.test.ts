import { describe, expect, it } from 'vitest'
import { workspaces } from './generated/api/console/workspaces/orpc.gen'

describe('generated workspace contracts', () => {
  it('exposes the current workspace summary operation', () => {
    expect(workspaces.current.summary.get).toBeDefined()
  })
})
