import type { AccessRulesEditorProps } from '@/app/components/access-rules-editor'
import { act, screen } from '@testing-library/react'
import { useStore } from '@/app/components/app/store'
import {
  useAppAccessRules,
  useAppResourceWhitelist,
  useAppResourceWhitelistConfig,
  useAppUserAccessSettings,
} from '@/service/access-control/use-app-access-config'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AppACLPermission } from '@/utils/permission'
import AppAccessConfigPage from '../index'

const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}))

let mockIsRbacEnabled = true

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) =>
  renderWithConsoleQuery(ui, {
    accountProfile: mockConsoleState.userProfile,
    systemFeatures: { rbac_enabled: mockIsRbacEnabled },
  })

const mockAppAccessRules = vi.hoisted(() => ({
  items: [] as AccessRulesEditorProps['rules'],
  isLoading: false,
}))

const createUserAccessSetting = (
  accountId: string,
): AccessRulesEditorProps['userAccessSettings'][number] => ({
  account: {
    account_id: accountId,
    account_name: accountId,
  },
  roles: [],
  access_policies: [],
})

const mockAppUserAccessSettings = vi.hoisted(() => ({
  data: [] as AccessRulesEditorProps['userAccessSettings'],
  pagination: {
    current_page: 1,
    per_page: 10,
    total_count: 0,
    total_pages: 0,
  },
  isLoading: false,
  isPlaceholderData: false,
}))

const mockAppResourceWhitelist = vi.hoisted(() => ({
  data: {
    account_ids: [] as string[],
  } as { account_ids?: string[] } | undefined,
}))

const mockAppResourceWhitelistConfig = vi.hoisted(() => ({
  data: {
    automatic_include_workspace_members: false,
  } as { automatic_include_workspace_members: boolean } | undefined,
}))

const mockAccessRulesEditor = vi.hoisted(() => ({
  props: null as AccessRulesEditorProps | null,
}))

const mockMutations = vi.hoisted(() => ({
  updateAutomaticIncludeWorkspaceMembers: vi.fn(),
  updateUserAccessSettings: vi.fn(),
  removeMemberBindings: vi.fn(),
  removeMemberBindingsAsync: vi.fn(),
  isUpdatingAutomaticIncludeWorkspaceMembers: false,
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

vi.mock('@/service/access-control/use-app-access-config', () => ({
  useAppAccessRules: vi.fn(() => ({
    data: { items: mockAppAccessRules.items },
    isLoading: mockAppAccessRules.isLoading,
  })),
  useAppUserAccessSettings: vi.fn(() => ({
    data: {
      data: mockAppUserAccessSettings.data,
      pagination: mockAppUserAccessSettings.pagination,
    },
    isLoading: mockAppUserAccessSettings.isLoading,
    isPlaceholderData: mockAppUserAccessSettings.isPlaceholderData,
  })),
  useAppResourceWhitelist: vi.fn(() => ({ data: mockAppResourceWhitelist.data })),
  useAppResourceWhitelistConfig: vi.fn(() => ({ data: mockAppResourceWhitelistConfig.data })),
  useUpdateAppAutomaticIncludeWorkspaceMembers: vi.fn(() => ({
    mutate: mockMutations.updateAutomaticIncludeWorkspaceMembers,
    isPending: mockMutations.isUpdatingAutomaticIncludeWorkspaceMembers,
  })),
  useUpdateAppUserAccessSettings: vi.fn(() => ({
    mutate: mockMutations.updateUserAccessSettings,
  })),
  useRemoveAppAccessPolicyMemberBindings: vi.fn(() => ({
    mutate: mockMutations.removeMemberBindings,
    mutateAsync: mockMutations.removeMemberBindingsAsync,
  })),
}))

vi.mock('@/app/components/access-rules-editor', () => ({
  default: (props: AccessRulesEditorProps) => {
    mockAccessRulesEditor.props = props
    return <div data-testid="access-rules-editor" />
  },
}))

describe('AppAccessConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = []
    mockIsRbacEnabled = true
    mockAppAccessRules.items = []
    mockAppAccessRules.isLoading = false
    mockAppUserAccessSettings.data = []
    mockAppUserAccessSettings.pagination = {
      current_page: 1,
      per_page: 10,
      total_count: 0,
      total_pages: 0,
    }
    mockAppUserAccessSettings.isLoading = false
    mockAppUserAccessSettings.isPlaceholderData = false
    mockAppResourceWhitelist.data = {
      account_ids: [],
    }
    mockAppResourceWhitelistConfig.data = {
      automatic_include_workspace_members: false,
    }
    mockMutations.isUpdatingAutomaticIncludeWorkspaceMembers = false
    mockMutations.removeMemberBindingsAsync.mockResolvedValue(undefined)
    mockAccessRulesEditor.props = null
    useStore.setState({
      appDetail: {
        id: 'app-1',
        maintainer: 'account-1',
        permission_keys: [AppACLPermission.AccessConfig],
      } as unknown as NonNullable<ReturnType<typeof useStore.getState>['appDetail']>,
    })
  })

  it('should render the first paginated member page with config and whitelist data', () => {
    mockAppResourceWhitelistConfig.data = {
      automatic_include_workspace_members: true,
    }
    mockAppUserAccessSettings.pagination = {
      current_page: 1,
      per_page: 10,
      total_count: 45,
      total_pages: 3,
    }
    mockAppResourceWhitelist.data = {
      account_ids: ['account-1', 'account-2'],
    }

    render(<AppAccessConfigPage appId="app-1" />)

    expect(
      screen.getByRole('heading', { name: 'common.settings.resourceAccess' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('access-rules-editor')).toBeInTheDocument()
    expect(useAppUserAccessSettings).toHaveBeenCalledWith('app-1', expect.any(String), 1, 10)
    expect(useAppResourceWhitelist).toHaveBeenCalledWith('app-1')
    expect(useAppResourceWhitelistConfig).toHaveBeenCalledWith('app-1')
    expect(mockAccessRulesEditor.props?.automaticIncludeWorkspaceMembers).toBe(true)
    expect(mockAccessRulesEditor.props?.existingAccountIds).toEqual(['account-1', 'account-2'])
    expect(mockAccessRulesEditor.props?.currentPage).toBe(1)
    expect(mockAccessRulesEditor.props?.pageSize).toBe(10)
    expect(mockAccessRulesEditor.props?.totalCount).toBe(45)
    expect(mockAccessRulesEditor.props?.totalPages).toBe(3)
    expect(mockAccessRulesEditor.props?.maintainerId).toBe('account-1')
  })

  it('should keep the switch state while the add-member whitelist is loading', () => {
    mockAppResourceWhitelistConfig.data = {
      automatic_include_workspace_members: true,
    }
    mockAppResourceWhitelist.data = undefined

    render(<AppAccessConfigPage appId="app-1" />)

    expect(mockAccessRulesEditor.props?.automaticIncludeWorkspaceMembers).toBe(true)
    expect(mockAccessRulesEditor.props?.existingAccountIds).toBeUndefined()
  })

  it('should request the selected member page', () => {
    render(<AppAccessConfigPage appId="app-1" />)

    act(() => mockAccessRulesEditor.props?.onPageChange?.(2))

    expect(useAppUserAccessSettings).toHaveBeenLastCalledWith('app-1', expect.any(String), 2, 10)
  })

  it('should request the selected page size from the first page', () => {
    render(<AppAccessConfigPage appId="app-1" />)

    act(() => mockAccessRulesEditor.props?.onPageChange?.(3))
    act(() => mockAccessRulesEditor.props?.onPageSizeChange?.(50))

    expect(useAppUserAccessSettings).toHaveBeenLastCalledWith('app-1', expect.any(String), 1, 50)
    expect(mockAccessRulesEditor.props?.pageSize).toBe(50)
  })

  it('should return to the first page when automatic member inclusion is disabled', () => {
    mockAppResourceWhitelistConfig.data = {
      automatic_include_workspace_members: true,
    }
    render(<AppAccessConfigPage appId="app-1" />)
    act(() => mockAccessRulesEditor.props?.onPageChange?.(2))

    act(() => mockAccessRulesEditor.props?.onAutomaticIncludeWorkspaceMembersChange?.(false))

    expect(useAppUserAccessSettings).toHaveBeenLastCalledWith('app-1', expect.any(String), 1, 10)
  })

  it('should jump to the new last page after adding a member', () => {
    mockAppUserAccessSettings.pagination = {
      current_page: 2,
      per_page: 10,
      total_count: 20,
      total_pages: 2,
    }
    mockAppResourceWhitelist.data = {
      // The whitelist can omit an implicitly included maintainer; pagination is authoritative.
      account_ids: Array.from({ length: 19 }, (_, index) => `account-${index + 1}`),
    }
    render(<AppAccessConfigPage appId="app-1" />)

    act(() => mockAccessRulesEditor.props?.onAddAccessSubject?.('account-21', ['default']))

    expect(mockMutations.updateUserAccessSettings).toHaveBeenCalledWith(
      { accountId: 'account-21', accessPolicyIds: ['default'] },
      expect.objectContaining({ onSuccess: expect.any(Function), onSettled: expect.any(Function) }),
    )
    const callbacks = mockMutations.updateUserAccessSettings.mock.calls.at(-1)?.[1] as {
      onSuccess: () => void
    }
    act(() => callbacks.onSuccess())
    expect(useAppUserAccessSettings).toHaveBeenLastCalledWith('app-1', expect.any(String), 3, 10)
  })

  it('should load the previous page after removing the only member on the last page', () => {
    mockAppUserAccessSettings.data = [createUserAccessSetting('account-11')]
    mockAppUserAccessSettings.pagination = {
      current_page: 2,
      per_page: 10,
      total_count: 11,
      total_pages: 2,
    }
    render(<AppAccessConfigPage appId="app-1" />)
    act(() => mockAccessRulesEditor.props?.onPageChange?.(2))

    act(() =>
      mockAccessRulesEditor.props?.onRemoveAccessPolicyMemberBinding?.('account-11', 'default'),
    )
    const callbacks = mockMutations.removeMemberBindings.mock.calls.at(-1)?.[1] as {
      onSuccess: () => void
    }
    mockAppUserAccessSettings.data = []
    mockAppUserAccessSettings.pagination = {
      current_page: 2,
      per_page: 10,
      total_count: 10,
      total_pages: 1,
    }
    mockAppUserAccessSettings.isPlaceholderData = true
    act(() => callbacks.onSuccess())

    expect(useAppUserAccessSettings).toHaveBeenLastCalledWith('app-1', expect.any(String), 1, 10)
    expect(mockAccessRulesEditor.props?.isLoadingUserAccessSettings).toBe(true)
  })

  it('should wire switch, policy update, and removal mutations', async () => {
    render(<AppAccessConfigPage appId="app-1" />)

    mockAccessRulesEditor.props?.onAutomaticIncludeWorkspaceMembersChange?.(true)
    expect(mockMutations.updateAutomaticIncludeWorkspaceMembers).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ onError: expect.any(Function), onSuccess: expect.any(Function) }),
    )

    mockAccessRulesEditor.props?.onUserAccessPoliciesChange?.('account-1', ['policy-1'])
    expect(mockMutations.updateUserAccessSettings).toHaveBeenCalledWith(
      { accountId: 'account-1', accessPolicyIds: ['policy-1'] },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    )

    mockAccessRulesEditor.props?.onRemoveAccessPolicyMemberBinding?.('account-3', 'policy-3')
    expect(mockMutations.removeMemberBindings).toHaveBeenCalledWith(
      [{ accessPolicyId: 'policy-3', accountIds: ['account-3'] }],
      expect.objectContaining({ onSettled: expect.any(Function) }),
    )

    const removals = [
      { accessPolicyId: 'policy-1', accountIds: ['account-1', 'account-2'] },
      { accessPolicyId: 'default', accountIds: ['account-4'] },
    ]
    await act(async () => {
      await mockAccessRulesEditor.props?.onBatchRemoveAccessPolicyMemberBindings?.(removals)
    })
    expect(mockMutations.removeMemberBindingsAsync).toHaveBeenCalledOnce()
    expect(mockMutations.removeMemberBindingsAsync).toHaveBeenCalledWith(removals)
  })

  it('should block member changes but allow permission updates during automatic inclusion', async () => {
    mockAppResourceWhitelistConfig.data = {
      automatic_include_workspace_members: true,
    }
    render(<AppAccessConfigPage appId="app-1" />)

    mockAccessRulesEditor.props?.onAddAccessSubject?.('account-2', ['default'])
    mockAccessRulesEditor.props?.onRemoveAccessPolicyMemberBinding?.('account-2', 'policy-1')
    await act(async () => {
      await mockAccessRulesEditor.props?.onBatchRemoveAccessPolicyMemberBindings?.([
        { accessPolicyId: 'policy-1', accountIds: ['account-2'] },
      ])
    })

    expect(mockMutations.updateUserAccessSettings).not.toHaveBeenCalled()
    expect(mockMutations.removeMemberBindings).not.toHaveBeenCalled()
    expect(mockMutations.removeMemberBindingsAsync).not.toHaveBeenCalled()

    mockAccessRulesEditor.props?.onUserAccessPoliciesChange?.('account-2', ['policy-2'])
    expect(mockMutations.updateUserAccessSettings).toHaveBeenCalledWith(
      { accountId: 'account-2', accessPolicyIds: ['policy-2'] },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    )
  })

  it('should not mount access config data hooks when access permission is missing', () => {
    useStore.setState({
      appDetail: {
        id: 'app-1',
        maintainer: 'account-1',
        permission_keys: [AppACLPermission.ViewLayout],
      } as NonNullable<ReturnType<typeof useStore.getState>['appDetail']>,
    })

    render(<AppAccessConfigPage appId="app-1" />)

    expect(screen.queryByTestId('access-rules-editor')).not.toBeInTheDocument()
    expect(useAppAccessRules).not.toHaveBeenCalled()
    expect(useAppUserAccessSettings).not.toHaveBeenCalled()
  })

  it('should not mount access config data hooks when RBAC is disabled', () => {
    mockIsRbacEnabled = false

    render(<AppAccessConfigPage appId="app-1" />)

    expect(screen.queryByTestId('access-rules-editor')).not.toBeInTheDocument()
    expect(useAppAccessRules).not.toHaveBeenCalled()
    expect(useAppUserAccessSettings).not.toHaveBeenCalled()
  })

  it('should allow the maintainer with app management workspace permission', () => {
    mockConsoleState.userProfile = { id: 'account-1' }
    mockConsoleState.workspacePermissionKeys = ['app.create_and_management']
    useStore.setState({
      appDetail: {
        id: 'app-1',
        maintainer: 'account-1',
        permission_keys: [],
      } as unknown as NonNullable<ReturnType<typeof useStore.getState>['appDetail']>,
    })

    render(<AppAccessConfigPage appId="app-1" />)

    expect(screen.getByTestId('access-rules-editor')).toBeInTheDocument()
  })
})
