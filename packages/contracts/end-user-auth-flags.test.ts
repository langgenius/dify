import { describe, expect, it } from 'vite-plus/test'
import { zGetFeaturesResponse } from './generated/api/console/features/zod.gen.ts'

describe('Console EndUser auth configuration contract', () => {
  it.each([false, true])('preserves Console configuration availability: %s', (enabled) => {
    expect(zGetFeaturesResponse.parse({ end_user_auth_enabled: enabled })).toMatchObject({
      end_user_auth_enabled: enabled,
    })
  })

  it('does not infer Console availability from WebApp policies or a missing flag', () => {
    expect(
      zGetFeaturesResponse.safeParse({
        account_login_enabled: true,
        allow_anonymous_end_user_auth: true,
      }).success,
    ).toBe(false)
  })

  it.each([null, 'true', 'false', 0, 1])('rejects a non-boolean Console flag: %j', (value) => {
    expect(zGetFeaturesResponse.safeParse({ end_user_auth_enabled: value }).success).toBe(false)
  })
})
