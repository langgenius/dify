import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { get, put } from '@/service/base'
import { useRolesOfMember, useUpdateRolesOfMember } from '../use-member-roles'

vi.mock('@/service/base', () => ({
  get: vi.fn(),
  put: vi.fn(),
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

describe('use-member-roles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(get).mockResolvedValue({ account_id: 'member-1', roles: [] })
    vi.mocked(put).mockResolvedValue({})
  })

  // Queries load roles for one workspace member.
  describe('Queries', () => {
    it('should fetch roles for a member id', async () => {
      renderHook(() => useRolesOfMember('member-1'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/members/member-1/rbac-roles')
      })
    })
  })

  // Mutations update role ids using the API contract body shape.
  describe('Mutations', () => {
    it('should update roles for a member id', async () => {
      const { result } = renderHook(() => useUpdateRolesOfMember(), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({
          memberId: 'member-1',
          roleIds: ['role-1'],
        })
      })

      expect(put).toHaveBeenCalledWith('/workspaces/current/rbac/members/member-1/rbac-roles', {
        body: { role_ids: ['role-1'] },
      })
    })
  })
})
