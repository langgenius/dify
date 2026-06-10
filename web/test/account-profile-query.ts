import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { UserProfileWithMeta } from '@/features/account-profile/client'
import { QueryClientProvider, QueryClient as TanStackQueryClient } from '@tanstack/react-query'
import { createElement } from 'react'
import { userProfileQueryOptions } from '@/features/account-profile/client'

const createMockAccountProfile = (
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
  profile: createMockAccountProfile(profile),
  meta: {
    currentVersion: null,
    currentEnv: null,
  },
})

export const createAccountProfileQueryClient = (
  profile: Partial<GetAccountProfileResponse> = {},
) => {
  const queryClient = new TanStackQueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })

  queryClient.setQueryData(
    userProfileQueryOptions().queryKey,
    createMockUserProfileResponse(profile),
  )

  return queryClient
}

export const createAccountProfileQueryWrapper = (
  profile: Partial<GetAccountProfileResponse> = {},
) => {
  const queryClient = createAccountProfileQueryClient(profile)

  return function AccountProfileQueryWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

export function AccountProfileQueryProvider({
  children,
  queryClient,
}: {
  children: ReactNode
  queryClient: QueryClient
}) {
  return createElement(QueryClientProvider, { client: queryClient }, children)
}
