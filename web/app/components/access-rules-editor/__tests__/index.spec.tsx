import type { AccessPolicyWithBindings, ResourceUserAccessSetting } from '@/models/access-control'
import type { Member } from '@/models/common'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccessRulesEditor from '../index'

const mockMembers = vi.hoisted(() => ({
  accounts: [] as Member[] | null,
  isLoading: false,
}))

vi.mock('@/service/use-common', () => ({
  useMembers: vi.fn(() => ({
    data: { accounts: mockMembers.accounts },
    isLoading: mockMembers.isLoading,
  })),
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

const createUserAccessSetting = (): ResourceUserAccessSetting => ({
  account: {
    account_id: 'account-1',
    account_name: 'Evan',
    email: 'evan@example.com',
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

const createMember = (overrides: Partial<Member> = {}): Member => ({
  id: 'account-2',
  name: 'Mia',
  email: 'mia@example.com',
  avatar: '',
  avatar_url: '',
  status: 'active',
  role: 'normal',
  roles: [],
  ...overrides,
} as Member)

describe('AccessRulesEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMembers.accounts = []
    mockMembers.isLoading = false
  })

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

  it('should disable resource access controls before open scope is available', () => {
    render(
      <AccessRulesEditor
        rules={[]}
        userAccessSettings={[]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        isUpdatingOpenScope={false}
        updatingAccountId={null}
      />,
    )

    expect(screen.getByText('permission.accessRule.resourceOpenScope')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'permission.accessRule.resourceOpenScopeDescription' })).toBeInTheDocument()

    const allMembersButton = screen.getByRole('button', { name: /permission\.accessRule\.allPermittedMembers/ })
    const onlyMeButton = screen.getByRole('button', { name: /permission\.accessRule\.onlyMe/ })
    const specificMembersButton = screen.getByRole('button', { name: /permission\.accessRule\.specificMembersOnly/ })
    expect(allMembersButton).toBeDisabled()
    expect(onlyMeButton).toBeDisabled()
    expect(specificMembersButton).toBeDisabled()
    expect(allMembersButton).toHaveAttribute('aria-pressed', 'false')
    expect(onlyMeButton).toHaveAttribute('aria-pressed', 'false')
    expect(specificMembersButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('should render resource access controls and update account exceptions', () => {
    const onOpenScopeChange = vi.fn()
    const onUserAccessPoliciesChange = vi.fn()
    const onRemoveAccessPolicyMemberBinding = vi.fn()

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
        onRemoveAccessPolicyMemberBinding={onRemoveAccessPolicyMemberBinding}
      />,
    )

    expect(screen.getByText('permission.accessRule.resourceOpenScope')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /permission\.accessRule\.specificMembersOnly/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('permission.accessRule.individualPermissionSettings')).toBeInTheDocument()
    expect(screen.getByText('Evan')).toBeInTheDocument()
    expect(screen.getByText('evan@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Maintainer')).not.toBeInTheDocument()
    expect(screen.getAllByText('Manage').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /permission\.accessRule\.allPermittedMembers/ }))
    expect(onOpenScopeChange).not.toHaveBeenCalled()
    expect(screen.getByText('permission.accessRule.changeOpenScopeTitle')).toBeInTheDocument()
    expect(screen.getByText('permission.accessRule.changeOpenScopeDescription')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.change' }))
    expect(onOpenScopeChange).toHaveBeenCalledWith('all')

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(onRemoveAccessPolicyMemberBinding).toHaveBeenCalledWith('account-1', 'app-policy-id')
  })

  it('should render and update the only-me resource access scope', () => {
    const onOpenScopeChange = vi.fn()

    render(
      <AccessRulesEditor
        rules={[]}
        userAccessSettings={[]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        openScope="only_me"
        isUpdatingOpenScope={false}
        updatingAccountId={null}
        onOpenScopeChange={onOpenScopeChange}
      />,
    )

    expect(screen.getByRole('button', { name: /permission\.accessRule\.onlyMe/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /permission\.accessRule\.specificMembersOnly/ }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.change' }))

    expect(onOpenScopeChange).toHaveBeenCalledWith('specific')
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

    expect(screen.getByText('permission.accessRule.defaultPermission')).toBeInTheDocument()
  })

  it('should mark maintainer rows and prevent editing them', () => {
    const onUserAccessPoliciesChange = vi.fn()
    const onRemoveAccessPolicyMemberBinding = vi.fn()

    render(
      <AccessRulesEditor
        rules={[createRule('app')]}
        userAccessSettings={[createUserAccessSetting()]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        openScope="specific"
        isUpdatingOpenScope={false}
        updatingAccountId={null}
        maintainerId="account-1"
        onUserAccessPoliciesChange={onUserAccessPoliciesChange}
        onRemoveAccessPolicyMemberBinding={onRemoveAccessPolicyMemberBinding}
      />,
    )

    expect(screen.getByText('permission.accessRule.maintainer')).toBeInTheDocument()
    expect(screen.getByLabelText(/permission\.accessRule\.exceptionPermissionFor/)).toBeDisabled()

    const removeButton = screen.getByRole('button', { name: 'common.operation.remove' })
    expect(removeButton).toBeDisabled()

    fireEvent.click(removeButton)
    expect(onUserAccessPoliciesChange).not.toHaveBeenCalled()
    expect(onRemoveAccessPolicyMemberBinding).not.toHaveBeenCalled()
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

  it('should add unassigned members with default permission', async () => {
    const user = userEvent.setup()
    const onAddAccessSubject = vi.fn()
    mockMembers.accounts = [
      createMember({
        id: 'account-1',
        name: 'Evan',
        email: 'evan@example.com',
      }),
      createMember(),
    ]

    render(
      <AccessRulesEditor
        rules={[]}
        userAccessSettings={[createUserAccessSetting()]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        openScope="specific"
        isUpdatingOpenScope={false}
        updatingAccountId={null}
        onAddAccessSubject={onAddAccessSubject}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))

    const dialog = screen.getByRole('dialog', { name: 'permission.accessRule.addMembersTitle' })
    expect(within(dialog).getByText('Evan')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'common.operation.added' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'permission.accessRule.addMemberAria:{"name":"Evan"}' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Mia')).toBeInTheDocument()
    expect(within(dialog).queryByRole('tablist')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'permission.accessRule.addMemberAria:{"name":"Mia"}' }))

    expect(onAddAccessSubject).toHaveBeenCalledWith('account-2', ['default'])
  })
})
