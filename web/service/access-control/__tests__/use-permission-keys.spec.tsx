// eslint-disable-next-line no-restricted-imports
import { get } from '@/service/base'
import { workspacePermissionKeysQueryOptions } from '../use-permission-keys'

vi.mock('@/service/base', () => ({
  get: vi.fn(),
}))

describe('workspacePermissionKeysQueryOptions', () => {
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
      const { queryFn } = workspacePermissionKeysQueryOptions()

      await queryFn()

      expect(get).toHaveBeenCalledWith('/workspaces/current/rbac/my-permissions')
    })
  })
})
