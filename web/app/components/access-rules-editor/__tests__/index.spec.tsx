import type { ReactNode } from 'react'
import type { AccessPolicyWithBindings, RemoveBindingPayload } from '@/models/access-control'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { put } from '@/service/base'
import AccessRulesEditor from '../index'

const appListQueryKey = ['console', 'apps', 'list']

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ appId: 'route-app-id' }),
}))

vi.mock('@/service/base', () => ({
  put: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      list: {
        key: () => appListQueryKey,
      },
    },
  },
}))

vi.mock('@/app/components/header/account-setting/access-rules-page/access-rule-row', () => ({
  default: ({
    rule,
    canManage,
    onAddRole,
    onRemove,
  }: {
    rule: AccessPolicyWithBindings
    canManage: boolean
    onAddRole?: (rule: AccessPolicyWithBindings) => void
    onRemove?: (payload: RemoveBindingPayload) => void
  }) => (
    <div>
      <span>{rule.policy.name}</span>
      {canManage && (
        <>
          <button type="button" onClick={() => onAddRole?.(rule)}>
            Add target
          </button>
          <button
            type="button"
            onClick={() => onRemove?.({
              policy_id: rule.policy.id,
              resource_type: rule.policy.resource_type,
              role_ids: [],
              account_ids: [],
            })}
          >
            Remove target
          </button>
        </>
      )}
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/access-rules-page/add-rule-targets-modal', () => ({
  default: ({ onSubmit }: { onSubmit: (selection: { roleIds: string[], memberIds: string[] }) => void }) => (
    <button
      type="button"
      onClick={() => onSubmit({ roleIds: ['role-new'], memberIds: ['member-new'] })}
    >
      Confirm add target
    </button>
  ),
}))

const createRule = (resourceType: 'app' | 'dataset'): AccessPolicyWithBindings => ({
  policy: {
    id: `${resourceType}-policy-id`,
    tenant_id: 'tenant-id',
    resource_type: resourceType,
    policy_key: `${resourceType}-policy-key`,
    name: `${resourceType} policy`,
    description: `${resourceType} policy description`,
    permission_keys: [],
    is_builtin: false,
    category: 'global_custom',
    created_at: '2026-05-22T00:00:00Z',
    updated_at: '2026-05-22T00:00:00Z',
  },
  roles: [],
  accounts: [],
})

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const renderWithQueryClient = (ui: ReactNode) => {
  const queryClient = createQueryClient()
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

  render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )

  return { invalidateQueries }
}

describe('AccessRulesEditor resource bindings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(put).mockResolvedValue({})
  })

  it('should update dataset bindings with the provided resource id', async () => {
    renderWithQueryClient(
      <AccessRulesEditor
        resourceId="dataset-resource-id"
        rules={[createRule('dataset')]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add target' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add target' }))

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/workspaces/current/rbac/datasets/dataset-resource-id/access-policies/dataset-policy-id/bindings', {
        body: {
          role_ids: ['role-new'],
          account_ids: ['member-new'],
        },
      })
    })
  })

  it('should update app bindings with the provided resource id', async () => {
    renderWithQueryClient(
      <AccessRulesEditor
        resourceId="app-resource-id"
        rules={[createRule('app')]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove target' }))

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith('/workspaces/current/rbac/apps/app-resource-id/access-policies/app-policy-id/bindings', {
        body: {
          role_ids: [],
          account_ids: [],
        },
      })
    })
  })

  it('should refresh app access rules, detail, and list after app bindings are updated', async () => {
    const { invalidateQueries } = renderWithQueryClient(
      <AccessRulesEditor
        resourceId="app-resource-id"
        rules={[createRule('app')]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove target' }))

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-access-config', 'app-access-rules', 'app-resource-id'] })
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['apps', 'detail', 'app-resource-id'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: appListQueryKey })
  })

  it('should refresh dataset access rules, detail, and list after dataset bindings are updated', async () => {
    const { invalidateQueries } = renderWithQueryClient(
      <AccessRulesEditor
        resourceId="dataset-resource-id"
        rules={[createRule('dataset')]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add target' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add target' }))

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dataset-access-config', 'dataset-access-rules', 'dataset-resource-id'] })
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dataset', 'detail', 'dataset-resource-id'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dataset', 'list'] })
  })
})
