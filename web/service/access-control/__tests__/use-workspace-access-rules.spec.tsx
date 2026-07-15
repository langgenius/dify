import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { del, get, post, put } from '@/service/base'
import {
  useCopyAccessRule,
  useCreateAccessRule,
  useDeleteAccessRule,
  useInfiniteWorkspaceAppAccessRules,
  useInfiniteWorkspaceDatasetAccessRules,
  useUpdateAccessRule,
} from '../use-workspace-access-rules'

vi.mock('@/service/base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
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

describe('use-workspace-access-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(get).mockResolvedValue({ items: [], pagination: {} })
    vi.mocked(post).mockResolvedValue({})
    vi.mocked(put).mockResolvedValue({})
    vi.mocked(del).mockResolvedValue({})
  })

  // Queries load workspace-level app and dataset access policies from separate endpoints.
  describe('Queries', () => {
    it('should fetch workspace app access rules', async () => {
      renderHook(() => useInfiniteWorkspaceAppAccessRules({ page: 1, limit: 20, language: 'zh' }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/workspace/apps/access-policy', {
          params: { page: 1, limit: 20, language: 'zh' },
        })
      })
    })

    it('should fetch workspace dataset access rules', async () => {
      renderHook(
        () => useInfiniteWorkspaceDatasetAccessRules({ page: 1, limit: 20, language: 'ja' }),
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith(
          '/workspaces/current/rbac/workspace/datasets/access-policy',
          {
            params: { page: 1, limit: 20, language: 'ja' },
          },
        )
      })
    })
  })

  // Rule mutations normalize form data to the API body expected by RBAC access policies.
  describe('Rule Mutations', () => {
    it('should create and update access rules', async () => {
      const createHook = renderHook(() => useCreateAccessRule(), { wrapper: createWrapper() })
      const updateHook = renderHook(() => useUpdateAccessRule(), { wrapper: createWrapper() })

      await act(async () => {
        await createHook.result.current.mutateAsync({
          resourceType: 'app',
          name: 'App rule',
          description: 'App access',
          permission_keys: ['app.acl.edit'],
        })
        await updateHook.result.current.mutateAsync({
          id: 'policy-1',
          resourceType: 'dataset',
          name: 'Dataset rule',
          description: 'Dataset access',
          permission_keys: ['dataset.acl.edit'],
        })
      })

      expect(post).toHaveBeenCalledWith('/workspaces/current/rbac/access-policies', {
        body: {
          resource_type: 'app',
          name: 'App rule',
          description: 'App access',
          permission_keys: ['app.acl.edit'],
        },
      })
      expect(put).toHaveBeenCalledWith('/workspaces/current/rbac/access-policies/policy-1', {
        body: {
          id: 'policy-1',
          name: 'Dataset rule',
          description: 'Dataset access',
          permission_keys: ['dataset.acl.edit'],
        },
      })
    })

    it('should copy and delete access rules by id', async () => {
      const copyHook = renderHook(() => useCopyAccessRule('app'), { wrapper: createWrapper() })
      const deleteHook = renderHook(() => useDeleteAccessRule('dataset'), {
        wrapper: createWrapper(),
      })

      await act(async () => {
        await copyHook.result.current.mutateAsync('policy-1')
        await deleteHook.result.current.mutateAsync('policy-2')
      })

      expect(post).toHaveBeenCalledWith(
        '/workspaces/current/rbac/access-policies/policy-1/copy',
        {},
      )
      expect(del).toHaveBeenCalledWith('/workspaces/current/rbac/access-policies/policy-2', {})
    })
  })
})
