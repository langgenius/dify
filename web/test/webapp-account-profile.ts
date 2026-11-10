import type { WebAccountProfileResponse } from '@dify/contracts/api/web/types.gen'

export const createWebAccountProfile = (
  overrides: Partial<WebAccountProfileResponse> = {},
): WebAccountProfileResponse => ({
  name: 'Test User',
  email: 'user@example.com',
  avatar: null,
  avatar_url: null,
  is_password_set: false,
  interface_language: null,
  interface_theme: null,
  timezone: null,
  has_owned_tenant: false,
  has_tenant: false,
  ...overrides,
})
