import { describe, expect, it } from 'vite-plus/test'
import {
  zAccountPasswordPayload,
  zAccountProfilePatchPayload,
} from './generated/api/console/account/zod.gen.ts'
import {
  zAccountProfilePatchPayload as zWebAccountProfilePatchPayload,
  zWebAccountPasswordPayload,
  zWebAccountProfileResponse,
} from './generated/api/web/zod.gen.ts'

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

  it('shares partial profile validation with WebApp settings', () => {
    expect(zWebAccountProfilePatchPayload.parse({})).toEqual({})
    expect(zWebAccountProfilePatchPayload.safeParse({ name: 'Jane' }).success).toBe(true)
    expect(zWebAccountProfilePatchPayload.safeParse({ name: null }).success).toBe(false)
    expect(zWebAccountProfilePatchPayload.safeParse({ email: 'other@example.com' }).success).toBe(
      false,
    )
  })

  it('allows an omitted current password but rejects null or unexpected fields', () => {
    const password = { new_password: 'new-password1', repeat_new_password: 'new-password1' }
    expect(zWebAccountPasswordPayload.parse(password)).toEqual({ ...password, password: '' })
    expect(zWebAccountPasswordPayload.safeParse({ ...password, password: null }).success).toBe(
      false,
    )
    expect(zWebAccountPasswordPayload.safeParse({ ...password, account_id: 'other' }).success).toBe(
      false,
    )
  })

  it('requires the Account settings needed by the WebApp account page', () => {
    const profile = {
      name: 'Jane',
      email: 'jane@example.com',
      avatar: null,
      avatar_url: null,
      is_password_set: false,
      interface_language: null,
      interface_theme: null,
      timezone: null,
      has_owned_tenant: false,
      has_tenant: false,
    }
    expect(zWebAccountProfileResponse.parse(profile)).toEqual(profile)
    expect(zWebAccountProfileResponse.safeParse({ name: 'Jane', avatar: null }).success).toBe(false)
  })
})
