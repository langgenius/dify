import { describe, expect, it } from 'vitest'
import { zAccountProfilePatchPayload } from './generated/api/console/account/zod.gen'

describe('generated account profile schema', () => {
  it('matches the server rules for partial updates', () => {
    expect(zAccountProfilePatchPayload.safeParse({ name: 'Jane' }).success).toBe(true)
    expect(zAccountProfilePatchPayload.safeParse({}).success).toBe(true)
    expect(zAccountProfilePatchPayload.safeParse({ name: null }).success).toBe(false)
    expect(
      zAccountProfilePatchPayload.safeParse({ name: 'Jane', unexpected: 'value' }).success,
    ).toBe(false)
  })
})
