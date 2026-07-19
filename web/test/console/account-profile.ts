import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { RenderHookOptions, RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { UserProfileWithMeta } from '@/features/account-profile/client'
import { render, renderHook } from '@testing-library/react'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'

const accountProfileQueryKey = [
  ['console', 'account', 'profile', 'get'],
  { type: 'query' },
] as const

const createAccountProfileFixture = (
  overrides: Partial<GetAccountProfileResponse> = {},
): GetAccountProfileResponse => ({
  id: 'user-1',
  name: 'Test User',
  email: 'test@dify.ai',
  avatar: '',
  avatar_url: null,
  is_password_set: false,
  timezone: 'Asia/Shanghai',
  ...overrides,
})

const createMockUserProfileResponse = (
  profile: Partial<GetAccountProfileResponse> = {},
): UserProfileWithMeta => ({
  profile: createAccountProfileFixture(profile),
  meta: {
    currentVersion: null,
    currentEnv: null,
  },
})

export const seedAccountProfileQuery = (
  queryClient: QueryClient,
  profile: Partial<GetAccountProfileResponse> = {},
) => {
  const data = createMockUserProfileResponse(profile)
  queryClient.setQueryData(accountProfileQueryKey, data)
  return data
}

export const ensureAccountProfileQuery = (
  queryClient: QueryClient,
  profile: Partial<GetAccountProfileResponse> = {},
) => {
  const existingProfile = queryClient.getQueryData<UserProfileWithMeta>(accountProfileQueryKey)
  if (existingProfile === undefined) return seedAccountProfileQuery(queryClient, profile)

  return existingProfile
}

export const createAccountProfileQueryClient = (
  profile: Partial<GetAccountProfileResponse> = {},
) => {
  const queryClient = createTestQueryClient()

  seedAccountProfileQuery(queryClient, profile)

  return queryClient
}

export const createAccountProfileQueryWrapper = (
  profile: Partial<GetAccountProfileResponse> = {},
) => {
  const queryClient = createAccountProfileQueryClient(profile)
  return createQueryClientWrapper(queryClient)
}

export const renderWithAccountProfile = (
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & {
    accountProfile?: Partial<GetAccountProfileResponse>
  } = {},
) => {
  const { accountProfile, ...renderOptions } = options
  return render(ui, {
    ...renderOptions,
    wrapper: createAccountProfileQueryWrapper(accountProfile),
  })
}

export const renderHookWithAccountProfile = <Result, Props = void>(
  callback: (props: Props) => Result,
  options: Omit<RenderHookOptions<Props>, 'wrapper'> & {
    accountProfile?: Partial<GetAccountProfileResponse>
  } = {},
) => {
  const { accountProfile, ...renderOptions } = options
  return renderHook(callback, {
    ...renderOptions,
    wrapper: createAccountProfileQueryWrapper(accountProfile),
  })
}
