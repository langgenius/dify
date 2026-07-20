import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { AccessMode, SubjectType } from '@/models/access-control'
import { consoleClient } from '@/service/client'
import { useUpdateAccessMode } from '..'

vi.mock('@/service/client', () => ({
  consoleClient: {
    enterprise: {
      webAppAuth: {
        updateWebAppWhitelistSubjects: vi.fn(),
      },
    },
  },
  consoleQuery: {
    enterprise: {
      webAppAuth: {
        getWebAppAccessMode: {
          key: vi.fn(() => ['enterprise', 'web-app-auth', 'access-mode']),
        },
      },
    },
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('access-control service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(consoleClient.enterprise.webAppAuth.updateWebAppWhitelistSubjects).mockResolvedValue(
      {},
    )
  })

  // Access mode updates keep the legacy webapp whitelist payload contract.
  describe('Mutations', () => {
    it('should update access mode with legacy subject type values', async () => {
      const { result } = renderHook(() => useUpdateAccessMode(), { wrapper: createWrapper() })

      result.current.mutate({
        appId: 'app-1',
        accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
        subjects: [
          { subjectId: 'group-1', subjectType: SubjectType.GROUP },
          { subjectId: 'account-1', subjectType: SubjectType.ACCOUNT },
        ],
      })

      await waitFor(() => {
        expect(
          consoleClient.enterprise.webAppAuth.updateWebAppWhitelistSubjects,
        ).toHaveBeenCalledWith({
          body: {
            appId: 'app-1',
            accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
            subjects: [
              { subjectId: 'group-1', subjectType: SubjectType.GROUP },
              { subjectId: 'account-1', subjectType: SubjectType.ACCOUNT },
            ],
          },
        })
      })
    })
  })
})
