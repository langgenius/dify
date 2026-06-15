import type { AccessPolicyWithBindings, ResourceUserAccessSetting } from '@/models/access-control'
import { fireEvent, render, screen } from '@testing-library/react'
import AccessRulesEditor from '../index'

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

const createUserAccessSetting = (): ResourceUserAccessSetting => ({
  account: {
    account_id: 'account-1',
    account_name: 'Evan',
  },
  roles: [{
    id: 'role-1',
    type: 'app',
    category: 'global_custom',
    name: 'Maintainer',
    is_builtin: false,
    permission_keys: [],
  }],
  access_policies: [{
    id: 'app-policy-id',
    tenant_id: 'tenant-id',
    resource_type: 'app',
    policy_key: 'app-policy-key',
    name: 'Manage',
    description: 'Can manage this app',
    permission_keys: [],
    is_builtin: false,
    category: 'global_custom',
  }],
})

const createDefaultUserAccessSetting = (): ResourceUserAccessSetting => ({
  ...createUserAccessSetting(),
  access_policies: [],
})

describe('AccessRulesEditor', () => {
  it('should render loading state before empty or row content', () => {
    render(
      <AccessRulesEditor
        rules={[]}
        userAccessSettings={[]}
        isLoadingRules
        isLoadingUserAccessSettings={false}
        openScope="specific"
        isUpdatingOpenScope={false}
        updatingAccountId={null}
      />,
    )

    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
    expect(screen.queryByText('permission.accessRule.noUserAccessSettings')).not.toBeInTheDocument()
  })

  it('should render empty state when there are no user access settings', () => {
    render(
      <AccessRulesEditor
        rules={[]}
        userAccessSettings={[]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        openScope="specific"
        isUpdatingOpenScope={false}
        updatingAccountId={null}
      />,
    )

    expect(screen.getByText('permission.accessRule.noUserAccessSettings')).toBeInTheDocument()
  })

  it('should render resource access controls and update account exceptions', () => {
    const onOpenScopeChange = vi.fn()
    const onUserAccessPoliciesChange = vi.fn()

    render(
      <AccessRulesEditor
        rules={[createRule('app')]}
        userAccessSettings={[createUserAccessSetting()]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        openScope="specific"
        isUpdatingOpenScope={false}
        updatingAccountId={null}
        onOpenScopeChange={onOpenScopeChange}
        onUserAccessPoliciesChange={onUserAccessPoliciesChange}
      />,
    )

    expect(screen.getByText('permission.accessRule.resourceOpenScope')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /permission\.accessRule\.specificMembersOnly/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('permission.accessRule.individualPermissionSettings')).toBeInTheDocument()
    expect(screen.getByText('Evan')).toBeInTheDocument()
    expect(screen.getAllByText('Manage').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /permission\.accessRule\.allPermittedMembers/ }))
    expect(onOpenScopeChange).not.toHaveBeenCalled()
    expect(screen.getByText('permission.accessRule.changeOpenScopeTitle')).toBeInTheDocument()
    expect(screen.getByText('permission.accessRule.changeOpenScopeDescription')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.change' }))
    expect(onOpenScopeChange).toHaveBeenCalledWith('all')

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(onUserAccessPoliciesChange).toHaveBeenCalledWith('account-1', [])
  })

  it('should render the fixed default option when an account has no exception policy', () => {
    render(
      <AccessRulesEditor
        rules={[createRule('app')]}
        userAccessSettings={[createDefaultUserAccessSetting()]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        openScope="specific"
        isUpdatingOpenScope={false}
        updatingAccountId={null}
      />,
    )

    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('should keep open scope unchanged when the confirmation is cancelled', () => {
    const onOpenScopeChange = vi.fn()

    render(
      <AccessRulesEditor
        rules={[]}
        userAccessSettings={[]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        openScope="specific"
        isUpdatingOpenScope={false}
        updatingAccountId={null}
        onOpenScopeChange={onOpenScopeChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /permission\.accessRule\.allPermittedMembers/ }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onOpenScopeChange).not.toHaveBeenCalled()
  })
})
