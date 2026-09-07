import { describe, expect, it } from 'vite-plus/test'
import {
  zAccountPasswordPayload,
  zAccountProfilePatchPayload,
} from './generated/api/console/account/zod.gen'

describe('generated account profile schema', () => {
  it('matches the server rules for partial updates', () => {
    expect(zAccountProfilePatchPayload.safeParse({ name: 'Jane' }).success).toBe(true)
    expect(zAccountProfilePatchPayload.safeParse({}).success).toBe(true)
    expect(zAccountProfilePatchPayload.parse({})).toEqual({})
    expect(zAccountProfilePatchPayload.safeParse({ name: null }).success).toBe(false)
    expect(
      zAccountProfilePatchPayload.safeParse({ name: 'Jane', unexpected: 'value' }).success,
    ).toBe(false)
  })

  it('does not synthesize server-side null defaults in request payloads', () => {
    expect(
      zAccountPasswordPayload.parse({
        new_password: 'new-password',
        repeat_new_password: 'new-password',
      }),
    ).toEqual({
      new_password: 'new-password',
      repeat_new_password: 'new-password',
    })
  })
})
