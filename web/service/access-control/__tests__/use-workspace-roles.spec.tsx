import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  useCopyWorkspaceRole,
  useCreateWorkspaceRole,
  useDeleteWorkspaceRole,
  useUpdateWorkspaceRole,
  useWorkspaceRoleList,
} from '../use-workspace-roles'

const mockServiceBase = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

vi.mock('../../base', () => mockServiceBase)

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

const roleListResponse = {
  data: [],
  pagination: {
    total_count: 0,
    per_page: 20,
    current_page: 1,
    total_pages: 1,
  },
}

describe('use-workspace-roles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockServiceBase.get.mockResolvedValue(roleListResponse)
    mockServiceBase.post.mockResolvedValue({})
    mockServiceBase.put.mockResolvedValue({})
    mockServiceBase.del.mockResolvedValue({})
  })

  // Role list pagination starts from the provided page and passes query params through.
  describe('Queries', () => {
    it('should fetch workspace roles with pagination params', async () => {
      renderHook(() => useWorkspaceRoleList({ page: 2, limit: 20 }), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(mockServiceBase.get).toHaveBeenCalledWith('/workspaces/current/rbac/roles', {
          params: {
            limit: 20,
            page: 2,
          },
        })
      })
    })
  })

  // Role mutations call the expected RBAC role management endpoints.
  describe('Mutations', () => {
    it('should create a workspace role', async () => {
      const { result } = renderHook(() => useCreateWorkspaceRole(), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({
          name: 'Support',
          description: 'Support role',
          permission_keys: ['workspace.member.manage'],
        })
      })

      expect(mockServiceBase.post).toHaveBeenCalledWith('/workspaces/current/rbac/roles', {
        body: {
          name: 'Support',
          description: 'Support role',
          permission_keys: ['workspace.member.manage'],
        },
      })
    })

    it('should update a workspace role', async () => {
      const { result } = renderHook(() => useUpdateWorkspaceRole(), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({
          id: 'role-1',
          name: 'Support',
          description: 'Support role',
          permission_keys: [],
        })
      })

      expect(mockServiceBase.put).toHaveBeenCalledWith('/workspaces/current/rbac/roles/role-1', {
        body: {
          id: 'role-1',
          name: 'Support',
          description: 'Support role',
          permission_keys: [],
        },
      })
    })

    it('should delete and copy workspace roles by id', async () => {
      const deleteHook = renderHook(() => useDeleteWorkspaceRole(), { wrapper: createWrapper() })
      const copyHook = renderHook(() => useCopyWorkspaceRole(), { wrapper: createWrapper() })

      await act(async () => {
        await deleteHook.result.current.mutateAsync('role-1')
        await copyHook.result.current.mutateAsync('role-2')
      })

      expect(mockServiceBase.del).toHaveBeenCalledWith('/workspaces/current/rbac/roles/role-1')
      expect(mockServiceBase.post).toHaveBeenCalledWith('/workspaces/current/rbac/roles/role-2/copy')
    })
  })
})
