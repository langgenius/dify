import { describe, expect, it } from 'vitest'
import { zReplaceUserAccessPoliciesPayload } from './generated/api/console/workspaces/zod.gen'
import { zFormSubmitResponse, zMemberRoleUpdatePayload } from './generated/api/openapi/zod.gen'

describe('strict generated Zod objects', () => {
  it('rejects properties forbidden by the OpenAPI schema', () => {
    expect(zMemberRoleUpdatePayload.safeParse({ role: 'normal' }).success).toBe(true)
    expect(zMemberRoleUpdatePayload.safeParse({ role: 'normal', unexpected: true }).success).toBe(
      false,
    )
  })

  it('keeps empty forbidden-property objects valid and strict', () => {
    expect(zFormSubmitResponse.safeParse({}).success).toBe(true)
    expect(zFormSubmitResponse.safeParse({ unexpected: true }).success).toBe(false)
  })

  it('rejects removed console contract properties', () => {
    expect(
      zReplaceUserAccessPoliciesPayload.safeParse({ access_policy_ids: ['policy-1'] }).success,
    ).toBe(true)
    expect(
      zReplaceUserAccessPoliciesPayload.safeParse({ account_ids: ['account-1'] }).success,
    ).toBe(false)
  })
})
