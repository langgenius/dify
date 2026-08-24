import type { AccessPolicyWithBindings, ResourceUserAccessSetting } from '@/models/access-control'
import type { Member } from '@/models/common'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccessRulesEditor from '../index'

const mockMembers = vi.hoisted(() => ({
  accounts: [] as Member[] | null,
  isLoading: false,
}))
const mockUseMembers = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-common', () => ({
  useMembers: mockUseMembers,
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
  roles: [
    {
      id: 'role-1',
      type: 'app',
      category: 'global_custom',
      name: 'Maintainer',
      is_builtin: false,
      permission_keys: [],
    },
  ],
  access_policies: [
    {
      id: 'app-policy-id',
      tenant_id: 'tenant-id',
      resource_type: 'app',
      policy_key: 'app-policy-key',
      name: 'Manage',
      description: 'Can manage this app',
      permission_keys: [],
      is_builtin: false,
      category: 'global_custom',
    },
  ],
})

const createDefaultUserAccessSetting = (): ResourceUserAccessSetting => ({
  ...createUserAccessSetting(),
  access_policies: [],
})

const createMember = (overrides: Partial<Member> = {}): Member =>
  ({
    id: 'account-2',
    name: 'Mia',
    email: 'mia@example.com',
    avatar: '',
    avatar_url: '',
    status: 'active',
    role: 'normal',
    roles: [],
    ...overrides,
  }) as Member

describe('AccessRulesEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMembers.accounts = []
    mockMembers.isLoading = false
    mockUseMembers.mockImplementation(() => ({
      data: { accounts: mockMembers.accounts },
      isLoading: mockMembers.isLoading,
    }))
  })

  it('should render loading state before empty or row content', () => {
    render(
      <AccessRulesEditor
        rules={[]}
        userAccessSettings={[]}
        isLoadingRules
        isLoadingUserAccessSettings={false}
        automaticIncludeWorkspaceMembers={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
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
        automaticIncludeWorkspaceMembers={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        updatingAccountId={null}
      />,
    )

    expect(screen.getByText('permission.accessRule.noUserAccessSettings')).toBeInTheDocument()
  })

  it('should disable automatic inclusion before its value is available', () => {
    render(
      <AccessRulesEditor
        rules={[]}
        userAccessSettings={[]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        updatingAccountId={null}
      />,
    )

    expect(
      screen.getByText('permission.accessRule.automaticallyIncludeWorkspaceMembersDescription'),
    ).toBeInTheDocument()
    const automaticInclusionSwitch = screen.getByRole('switch', {
      name: 'permission.accessRule.automaticallyIncludeWorkspaceMembers',
    })
    expect(automaticInclusionSwitch).toHaveAttribute('aria-disabled', 'true')
    expect(automaticInclusionSwitch).toHaveAttribute('aria-checked', 'false')
  })

  it('should toggle automatic inclusion and update account exceptions', async () => {
    const user = userEvent.setup()
    const onAutomaticIncludeWorkspaceMembersChange = vi.fn()
    const onUserAccessPoliciesChange = vi.fn()
    const onRemoveAccessPolicyMemberBinding = vi.fn()

    render(
      <AccessRulesEditor
        rules={[createRule('app')]}
        userAccessSettings={[createUserAccessSetting()]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        automaticIncludeWorkspaceMembers={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        updatingAccountId={null}
        onAutomaticIncludeWorkspaceMembersChange={onAutomaticIncludeWorkspaceMembersChange}
        onUserAccessPoliciesChange={onUserAccessPoliciesChange}
        onRemoveAccessPolicyMemberBinding={onRemoveAccessPolicyMemberBinding}
      />,
    )

    expect(screen.getByText('permission.accessRule.allowedMembers')).toBeInTheDocument()
    expect(screen.getByText('Evan')).toBeInTheDocument()
    expect(screen.getByText('evan@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Maintainer')).not.toBeInTheDocument()
    expect(screen.getAllByText('Manage').length).toBeGreaterThan(0)

    await user.click(
      screen.getByRole('switch', {
        name: 'permission.accessRule.automaticallyIncludeWorkspaceMembers',
      }),
    )
    expect(onAutomaticIncludeWorkspaceMembersChange).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(onRemoveAccessPolicyMemberBinding).toHaveBeenCalledWith('account-1', 'app-policy-id')
  })

  it('should render and remove the default access policy', async () => {
    const user = userEvent.setup()
    const onRemoveAccessPolicyMemberBinding = vi.fn()

    render(
      <AccessRulesEditor
        rules={[createRule('app')]}
        userAccessSettings={[createDefaultUserAccessSetting()]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        automaticIncludeWorkspaceMembers={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        updatingAccountId={null}
        onRemoveAccessPolicyMemberBinding={onRemoveAccessPolicyMemberBinding}
      />,
    )

    expect(screen.getByText('permission.accessRule.defaultPermission')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(onRemoveAccessPolicyMemberBinding).toHaveBeenCalledWith('account-1', 'default')
  })

  it('should disable membership changes while automatic inclusion is enabled', () => {
    render(
      <AccessRulesEditor
        rules={[createRule('app')]}
        userAccessSettings={[createUserAccessSetting()]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        automaticIncludeWorkspaceMembers
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        existingAccountIds={['account-1']}
        updatingAccountId={null}
        onUserAccessPoliciesChange={vi.fn()}
        onRemoveAccessPolicyMemberBinding={vi.fn()}
        onAddAccessSubject={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'common.operation.add' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'common.operation.selectAll' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('checkbox', { name: 'Evan' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'common.operation.remove' })).toBeDisabled()
    expect(
      screen.getByLabelText(/permission\.accessRule\.exceptionPermissionFor/),
    ).not.toBeDisabled()
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
        automaticIncludeWorkspaceMembers={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        updatingAccountId={null}
        maintainerId="account-1"
        onUserAccessPoliciesChange={onUserAccessPoliciesChange}
        onRemoveAccessPolicyMemberBinding={onRemoveAccessPolicyMemberBinding}
      />,
    )

    expect(screen.getByText('permission.accessRule.maintainer')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Evan' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByLabelText(/permission\.accessRule\.exceptionPermissionFor/)).toBeDisabled()

    const removeButton = screen.getByRole('button', { name: 'common.operation.remove' })
    expect(removeButton).toBeDisabled()

    fireEvent.click(removeButton)
    expect(onUserAccessPoliciesChange).not.toHaveBeenCalled()
    expect(onRemoveAccessPolicyMemberBinding).not.toHaveBeenCalled()
  })

  it('should navigate through member pages and change the page size', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()

    render(
      <AccessRulesEditor
        rules={[]}
        userAccessSettings={[]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        automaticIncludeWorkspaceMembers={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        currentPage={1}
        pageSize={10}
        totalPages={3}
        updatingAccountId={null}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    expect(onPageChange).toHaveBeenCalledWith(2)

    expect(screen.getByRole('radio', { name: '10' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: '25' }))
    expect(onPageSizeChange).toHaveBeenCalledWith(25)
  })

  it('should load members only after opening the add-member popover', async () => {
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
        automaticIncludeWorkspaceMembers={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        existingAccountIds={['account-1']}
        updatingAccountId={null}
        onAddAccessSubject={onAddAccessSubject}
      />,
    )

    expect(mockUseMembers).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(mockUseMembers).toHaveBeenCalledTimes(1)

    const dialog = await screen.findByRole('dialog', {
      name: 'permission.accessRule.addMembersTitle',
    })
    expect(within(dialog).getByText('Evan')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'common.operation.added' })).toBeDisabled()
    expect(
      within(dialog).queryByRole('button', {
        name: 'permission.accessRule.addMemberAria:{"name":"Evan"}',
      }),
    ).not.toBeInTheDocument()
    expect(within(dialog).getByText('Mia')).toBeInTheDocument()
    expect(within(dialog).queryByRole('tablist')).not.toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('button', {
        name: 'permission.accessRule.addMemberAria:{"name":"Mia"}',
      }),
    )

    expect(onAddAccessSubject).toHaveBeenCalledWith('account-2', ['default'])
  })

  it('should select individual rows and all selectable rows on the current page', async () => {
    const user = userEvent.setup()
    const firstSetting = createUserAccessSetting()
    const secondSetting = {
      ...createUserAccessSetting(),
      account: {
        account_id: 'account-2',
        account_name: 'Mia',
        email: 'mia@example.com',
      },
    }

    render(
      <AccessRulesEditor
        rules={[createRule('app')]}
        userAccessSettings={[firstSetting, secondSetting]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        automaticIncludeWorkspaceMembers={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        updatingAccountId={null}
        onBatchRemoveAccessPolicyMemberBindings={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    const selectAll = screen.getByRole('checkbox', { name: 'common.operation.selectAll' })
    const evan = screen.getByRole('checkbox', { name: 'Evan' })
    const mia = screen.getByRole('checkbox', { name: 'Mia' })

    await user.click(evan)
    expect(evan).toBeChecked()
    expect(selectAll).toHaveAttribute('data-indeterminate')

    await user.click(selectAll)
    expect(evan).toBeChecked()
    expect(mia).toBeChecked()
    expect(selectAll).toBeChecked()
  })

  it('should batch-remove selected members grouped by access policy', async () => {
    const user = userEvent.setup()
    const onBatchRemoveAccessPolicyMemberBindings = vi.fn().mockResolvedValue(undefined)
    const firstSetting = createUserAccessSetting()
    const secondSetting = {
      ...createUserAccessSetting(),
      account: {
        account_id: 'account-2',
        account_name: 'Mia',
        email: 'mia@example.com',
      },
    }
    const thirdSetting = {
      ...createDefaultUserAccessSetting(),
      account: {
        account_id: 'account-3',
        account_name: 'Zoe',
        email: 'zoe@example.com',
      },
    }

    render(
      <AccessRulesEditor
        rules={[createRule('app')]}
        userAccessSettings={[firstSetting, secondSetting, thirdSetting]}
        isLoadingRules={false}
        isLoadingUserAccessSettings={false}
        automaticIncludeWorkspaceMembers={false}
        isUpdatingAutomaticIncludeWorkspaceMembers={false}
        updatingAccountId={null}
        onBatchRemoveAccessPolicyMemberBindings={onBatchRemoveAccessPolicyMemberBindings}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'common.operation.selectAll' }))
    expect(screen.getByText('permission.accessRule.selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'permission.accessRule.batchRemoveTitle',
    })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.sure' }))

    expect(onBatchRemoveAccessPolicyMemberBindings).toHaveBeenCalledWith([
      { accessPolicyId: 'app-policy-id', accountIds: ['account-1', 'account-2'] },
      { accessPolicyId: 'default', accountIds: ['account-3'] },
    ])
    expect(screen.queryByText('permission.accessRule.selected')).not.toBeInTheDocument()
  })
})
