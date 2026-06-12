import type { ReactNode } from 'react'
import type { AccessRuleRowProps } from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import type { AddRuleTargetsModalProps } from '@/app/components/header/account-setting/access-rules-page/add-rule-targets-modal'
import type { AccessPolicyWithBindings } from '@/models/access-control'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AccessRulesEditor from '../index'

const appListQueryKey = ['console', 'apps', 'list']
const mockServiceBase = vi.hoisted(() => ({
  put: vi.fn(),
}))
const mockAccessRuleRow = vi.hoisted(() => ({
  props: [] as AccessRuleRowProps[],
}))
const mockAddRuleTargetsModal = vi.hoisted(() => ({
  props: null as AddRuleTargetsModalProps | null,
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ appId: 'route-app-id' }),
}))

vi.mock('@/service/base', () => ({
  put: mockServiceBase.put,
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
  default: (props: AccessRuleRowProps) => {
    const {
      rule,
      canManage,
      onAddRole,
      onRemove,
    } = props
    mockAccessRuleRow.props.push(props)

    return (
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
    )
  },
}))

vi.mock('@/app/components/header/account-setting/access-rules-page/add-rule-targets-modal', () => ({
  default: (props: AddRuleTargetsModalProps) => {
    mockAddRuleTargetsModal.props = props

    return (
      <button
        type="button"
        onClick={() => props.onSubmit({ roleIds: ['role-new'], memberIds: ['member-new'] })}
      >
        Confirm add target
      </button>
    )
  },
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
    mockServiceBase.put.mockResolvedValue({})
    mockAccessRuleRow.props = []
    mockAddRuleTargetsModal.props = null
  })

  it('should render the resource access rules panel summary and rows', () => {
    const rule = createRule('app')
    rule.roles = [{
      role_id: 'role-1',
      role_name: 'App Editor',
      binding_id: 'role-binding-1',
      is_locked: true,
      role_tag: '',
    }]
    rule.accounts = [{
      account_id: 'member-1',
      account_name: 'Levi',
      binding_id: 'member-binding-1',
      is_locked: false,
    }]

    renderWithQueryClient(
      <AccessRulesEditor
        resourceId="app-resource-id"
        title="App access rules"
        rules={[rule]}
        canManage
      />,
    )

    expect(screen.getByRole('heading', { name: 'App access rules' })).toBeInTheDocument()
    expect(screen.getByText(/permission\.accessRule\.summary/)).toHaveTextContent('"count":1')
    expect(screen.getByText(/permission\.accessRule\.lockedSummary/)).toHaveTextContent('"count":1')
    expect(mockAccessRuleRow.props[0]?.bindingTarget).toBe('resource')
    expect(mockAccessRuleRow.props[0]?.showMenu).toBe(false)
  })

  it('should render loading state before empty or row content', () => {
    renderWithQueryClient(
      <AccessRulesEditor
        resourceId="app-resource-id"
        title="App access rules"
        rules={[]}
        canManage
        isLoadingRules
      />,
    )

    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
    expect(screen.queryByText('permission.accessRule.noRules')).not.toBeInTheDocument()
    expect(mockAccessRuleRow.props).toHaveLength(0)
  })

  it('should pass locked bindings to the add targets modal', () => {
    const rule = createRule('app')
    rule.roles = [{
      role_id: 'role-locked',
      role_name: 'Locked Role',
      binding_id: 'role-binding-locked',
      is_locked: true,
      role_tag: '',
    }, {
      role_id: 'role-open',
      role_name: 'Open Role',
      binding_id: 'role-binding-open',
      is_locked: false,
      role_tag: '',
    }]
    rule.accounts = [{
      account_id: 'member-locked',
      account_name: 'Locked Member',
      binding_id: 'member-binding-locked',
      is_locked: true,
    }]

    renderWithQueryClient(
      <AccessRulesEditor
        resourceId="app-resource-id"
        rules={[rule]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add target' }))

    expect(mockAddRuleTargetsModal.props?.initialRoleIds).toEqual(['role-locked', 'role-open'])
    expect(mockAddRuleTargetsModal.props?.lockedRoleIds).toEqual(['role-locked'])
    expect(mockAddRuleTargetsModal.props?.initialMemberIds).toEqual(['member-locked'])
    expect(mockAddRuleTargetsModal.props?.lockedMemberIds).toEqual(['member-locked'])
  })

  it('should keep full-access owner roles locked and preserve them when updating targets', async () => {
    const rule = createRule('app')
    rule.policy.policy_key = 'app.full_access'
    rule.roles = [{
      role_id: 'owner-role',
      role_name: 'Owner',
      binding_id: 'owner-binding',
      is_locked: false,
      role_tag: 'owner',
    }]

    renderWithQueryClient(
      <AccessRulesEditor
        resourceId="app-resource-id"
        rules={[rule]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add target' }))

    expect(mockAddRuleTargetsModal.props?.initialRoleIds).toEqual(['owner-role'])
    expect(mockAddRuleTargetsModal.props?.lockedRoleIds).toEqual(['owner-role'])

    fireEvent.click(screen.getByRole('button', { name: 'Confirm add target' }))

    await waitFor(() => {
      expect(mockServiceBase.put).toHaveBeenCalledWith('/workspaces/current/rbac/apps/app-resource-id/access-policies/app-policy-id/bindings', {
        body: {
          role_ids: ['role-new', 'owner-role'],
          account_ids: ['member-new'],
        },
      })
    })
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
      expect(mockServiceBase.put).toHaveBeenCalledWith('/workspaces/current/rbac/datasets/dataset-resource-id/access-policies/dataset-policy-id/bindings', {
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
      expect(mockServiceBase.put).toHaveBeenCalledWith('/workspaces/current/rbac/apps/app-resource-id/access-policies/app-policy-id/bindings', {
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
