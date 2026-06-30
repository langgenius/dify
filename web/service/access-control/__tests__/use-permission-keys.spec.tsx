import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { get } from '@/service/base'
import { useWorkspacePermissionKeys } from '../use-permission-keys'

vi.mock('@/service/base', () => ({
  get: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useWorkspacePermissionKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(get).mockResolvedValue({
      workspace: { permission_keys: [] },
      app: { default_permission_keys: [], overrides: [] },
      dataset: { default_permission_keys: [], overrides: [] },
    })
  })

  // Current-user permissions come from the my-permissions RBAC endpoint.
  describe('Queries', () => {
    it('should fetch workspace permission keys', async () => {
      renderHook(() => useWorkspacePermissionKeys(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/my-permissions')
      })
    })
  })
})
