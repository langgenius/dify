import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { get } from '@/service/base'
import {
  useAppPermissionCatalog,
  useDatasetPermissionCatalog,
  useWorkspacePermissionCatalog,
} from '../use-permission-catalog'

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

describe('use-permission-catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(get).mockResolvedValue({ groups: [] })
  })

  // Permission catalogs use separate workspace/app/dataset endpoints.
  describe('Queries', () => {
    it('should fetch workspace permission catalog', async () => {
      renderHook(() => useWorkspacePermissionCatalog(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/role-permissions/catalog')
      })
    })

    it('should fetch app permission catalog when enabled', async () => {
      renderHook(() => useAppPermissionCatalog(true), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/role-permissions/catalog/app')
      })
    })

    it('should fetch dataset permission catalog when enabled', async () => {
      renderHook(() => useDatasetPermissionCatalog(true), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/role-permissions/catalog/dataset')
      })
    })

    it('should not fetch resource catalogs when disabled', () => {
      renderHook(() => useAppPermissionCatalog(false), { wrapper: createWrapper() })
      renderHook(() => useDatasetPermissionCatalog(false), { wrapper: createWrapper() })

      expect(get).not.toHaveBeenCalled()
    })
  })
})
