import type { AccessRulesEditorProps } from '@/app/components/access-rules-editor'
import { act, screen, waitFor } from '@testing-library/react'
import {
  useDatasetAccessRules,
  useDatasetResourceWhitelist,
  useDatasetResourceWhitelistConfig,
  useDatasetUserAccessSettings,
} from '@/service/access-control/use-dataset-access-config'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetAccessConfigPage from '../index'

const mockDatasetAccessRules = vi.hoisted(() => ({
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

const mockDatasetUserAccessSettings = vi.hoisted(() => ({
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

const mockDatasetResourceWhitelist = vi.hoisted(() => ({
  data: {
    account_ids: [] as string[],
  } as { account_ids?: string[] } | undefined,
}))

const mockDatasetResourceWhitelistConfig = vi.hoisted(() => ({
  data: {
    automatic_include_workspace_members: false,
  } as { automatic_include_workspace_members: boolean } | undefined,
}))

const mockDatasetDetail = vi.hoisted(() => ({
  dataset: undefined as { maintainer?: string | null; permission_keys?: string[] } | undefined,
}))

const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}))

let mockIsRbacEnabled = true

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: { rbac_enabled: mockIsRbacEnabled },
  })

const mockAccessRulesEditor = vi.hoisted(() => ({
  props: null as AccessRulesEditorProps | null,
}))

const mockMutations = vi.hoisted(() => ({
  updateAutomaticIncludeWorkspaceMembers: vi.fn(),
  updateUserAccessSettings: vi.fn(),
  removeMemberBindings: vi.fn(),
}))

vi.mock('@/service/access-control/use-dataset-access-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/access-control/use-dataset-access-config')>()),
  useDatasetAccessRules: vi.fn(() => ({
    data: { items: mockDatasetAccessRules.items },
    isLoading: mockDatasetAccessRules.isLoading,
  })),
  useDatasetUserAccessSettings: vi.fn(() => ({
    data: {
      data: mockDatasetUserAccessSettings.data,
      pagination: mockDatasetUserAccessSettings.pagination,
    },
    isLoading: mockDatasetUserAccessSettings.isLoading,
    isPlaceholderData: mockDatasetUserAccessSettings.isPlaceholderData,
  })),
  useDatasetResourceWhitelist: vi.fn(() => ({ data: mockDatasetResourceWhitelist.data })),
  useDatasetResourceWhitelistConfig: vi.fn(() => ({
    data: mockDatasetResourceWhitelistConfig.data,
  })),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: vi.fn(
    (
      selector: (state: {
        dataset?: { maintainer?: string | null; permission_keys?: string[] }
      }) => unknown,
    ) => selector({ dataset: mockDatasetDetail.dataset }),
  ),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

vi.mock('@/app/components/access-rules-editor', () => ({
  default: (props: AccessRulesEditorProps) => {
    mockAccessRulesEditor.props = props
    return <div data-testid="access-rules-editor" />
  },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.rbac.datasets.byDatasetId.whitelist.put':
        mockMutations.updateAutomaticIncludeWorkspaceMembers,
      'workspaces.current.rbac.datasets.byDatasetId.users.byTargetAccountId.accessPolicies.put':
        mockMutations.updateUserAccessSettings,
      'workspaces.current.rbac.datasets.byDatasetId.accessPolicies.byPolicyId.memberBindings.delete':
        mockMutations.removeMemberBindings,
    }),
  }
})

describe('DatasetAccessConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetAccessRules.items = []
    mockDatasetAccessRules.isLoading = false
    mockDatasetUserAccessSettings.data = []
    mockDatasetUserAccessSettings.pagination = {
      current_page: 1,
      per_page: 10,
      total_count: 0,
      total_pages: 0,
    }
    mockDatasetUserAccessSettings.isLoading = false
    mockDatasetUserAccessSettings.isPlaceholderData = false
    mockDatasetResourceWhitelist.data = {
      account_ids: [],
    }
    mockDatasetResourceWhitelistConfig.data = {
      automatic_include_workspace_members: false,
    }
    mockMutations.removeMemberBindings.mockResolvedValue({})
    mockMutations.updateUserAccessSettings.mockResolvedValue({})
    mockMutations.updateAutomaticIncludeWorkspaceMembers.mockResolvedValue({})
    mockDatasetDetail.dataset = {
      maintainer: 'maintainer-1',
      permission_keys: [DatasetACLPermission.AccessConfig],
    }
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = []
    mockIsRbacEnabled = true
    mockAccessRulesEditor.props = null
  })

  it('should render the first paginated member page with config and whitelist data', () => {
    mockDatasetResourceWhitelistConfig.data = {
      automatic_include_workspace_members: true,
    }
    mockDatasetUserAccessSettings.pagination = {
      current_page: 1,
      per_page: 10,
      total_count: 21,
      total_pages: 2,
    }
    mockDatasetResourceWhitelist.data = {
      account_ids: ['maintainer-1', 'account-2'],
    }

    render(<DatasetAccessConfigPage datasetId="dataset-1" />)

    expect(
      screen.getByRole('heading', { name: 'navigation.settings.resourceAccess' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('access-rules-editor')).toBeInTheDocument()
    expect(useDatasetUserAccessSettings).toHaveBeenCalledWith(
      'dataset-1',
      expect.any(String),
      1,
      10,
      { enabled: true },
    )
    expect(useDatasetResourceWhitelist).toHaveBeenCalledWith('dataset-1', { enabled: true })
    expect(useDatasetResourceWhitelistConfig).toHaveBeenCalledWith('dataset-1', {
      enabled: true,
    })
    expect(mockAccessRulesEditor.props!.automaticIncludeWorkspaceMembers).toBe(true)
    expect(mockAccessRulesEditor.props!.existingAccountIds).toEqual(['maintainer-1', 'account-2'])
    expect(mockAccessRulesEditor.props!.currentPage).toBe(1)
    expect(mockAccessRulesEditor.props!.pageSize).toBe(10)
    expect(mockAccessRulesEditor.props!.totalCount).toBe(21)
    expect(mockAccessRulesEditor.props!.totalPages).toBe(2)
    expect(mockAccessRulesEditor.props!.maintainerId).toBe('maintainer-1')
  })

  it('should request the selected member page', () => {
    render(<DatasetAccessConfigPage datasetId="dataset-1" />)

    act(() => mockAccessRulesEditor.props!.onPageChange!(2))

    expect(useDatasetUserAccessSettings).toHaveBeenLastCalledWith(
      'dataset-1',
      expect.any(String),
      2,
      10,
      { enabled: true },
    )
  })

  it('should request the selected page size from the first page', () => {
    render(<DatasetAccessConfigPage datasetId="dataset-1" />)

    act(() => mockAccessRulesEditor.props!.onPageChange!(3))
    act(() => mockAccessRulesEditor.props!.onPageSizeChange!(25))

    expect(useDatasetUserAccessSettings).toHaveBeenLastCalledWith(
      'dataset-1',
      expect.any(String),
      1,
      25,
      { enabled: true },
    )
    expect(mockAccessRulesEditor.props!.pageSize).toBe(25)
  })

  it('should return to the first page when automatic member inclusion is disabled', async () => {
    mockDatasetResourceWhitelistConfig.data = {
      automatic_include_workspace_members: true,
    }
    render(<DatasetAccessConfigPage datasetId="dataset-1" />)
    act(() => mockAccessRulesEditor.props!.onPageChange!(2))

    await act(async () => {
      mockAccessRulesEditor.props!.onAutomaticIncludeWorkspaceMembersChange!(false)
    })

    expect(useDatasetUserAccessSettings).toHaveBeenLastCalledWith(
      'dataset-1',
      expect.any(String),
      1,
      10,
      { enabled: true },
    )
  })

  it('should jump to the new last page after adding a member', async () => {
    mockDatasetUserAccessSettings.pagination = {
      current_page: 1,
      per_page: 10,
      total_count: 10,
      total_pages: 1,
    }
    mockDatasetResourceWhitelist.data = {
      // The whitelist can omit an implicitly included maintainer; pagination is authoritative.
      account_ids: Array.from({ length: 9 }, (_, index) => `account-${index + 1}`),
    }
    render(<DatasetAccessConfigPage datasetId="dataset-1" />)

    await act(async () => {
      mockAccessRulesEditor.props!.onAddAccessSubject!('account-11', ['default'])
    })

    await act(async () => {})
    expect(useDatasetUserAccessSettings).toHaveBeenLastCalledWith(
      'dataset-1',
      expect.any(String),
      2,
      10,
      { enabled: true },
    )
  })

  it('should load the previous page after removing every member on the last page', async () => {
    mockDatasetUserAccessSettings.data = [
      createUserAccessSetting('account-11'),
      createUserAccessSetting('account-12'),
    ]
    mockDatasetUserAccessSettings.pagination = {
      current_page: 2,
      per_page: 10,
      total_count: 12,
      total_pages: 2,
    }
    render(<DatasetAccessConfigPage datasetId="dataset-1" />)
    act(() => mockAccessRulesEditor.props!.onPageChange!(2))

    mockDatasetUserAccessSettings.data = []
    mockDatasetUserAccessSettings.pagination = {
      current_page: 2,
      per_page: 10,
      total_count: 10,
      total_pages: 1,
    }
    mockDatasetUserAccessSettings.isPlaceholderData = true
    await act(async () => {
      await mockAccessRulesEditor.props!.onBatchRemoveAccessPolicyMemberBindings!([
        { accessPolicyId: 'default', accountIds: ['account-11', 'account-12'] },
      ])
    })

    expect(useDatasetUserAccessSettings).toHaveBeenLastCalledWith(
      'dataset-1',
      expect.any(String),
      1,
      10,
      { enabled: true },
    )
    expect(mockAccessRulesEditor.props!.isLoadingUserAccessSettings).toBe(true)
  })

  it('should disable all access config queries when permission is missing', () => {
    mockDatasetDetail.dataset = {
      maintainer: 'account-1',
      permission_keys: [],
    }

    render(<DatasetAccessConfigPage datasetId="dataset-1" />)

    expect(screen.queryByTestId('access-rules-editor')).not.toBeInTheDocument()
    expect(useDatasetAccessRules).toHaveBeenCalledWith('dataset-1', expect.any(String), {
      enabled: false,
    })
    expect(useDatasetUserAccessSettings).toHaveBeenCalledWith(
      'dataset-1',
      expect.any(String),
      1,
      10,
      { enabled: false },
    )
    expect(useDatasetResourceWhitelist).toHaveBeenCalledWith('dataset-1', { enabled: false })
    expect(useDatasetResourceWhitelistConfig).toHaveBeenCalledWith('dataset-1', {
      enabled: false,
    })
  })

  it('should disable all access config queries when RBAC is disabled', () => {
    mockIsRbacEnabled = false

    render(<DatasetAccessConfigPage datasetId="dataset-1" />)

    expect(screen.queryByTestId('access-rules-editor')).not.toBeInTheDocument()
    expect(useDatasetUserAccessSettings).toHaveBeenCalledWith(
      'dataset-1',
      expect.any(String),
      1,
      10,
      { enabled: false },
    )
    expect(useDatasetResourceWhitelist).toHaveBeenCalledWith('dataset-1', { enabled: false })
    expect(useDatasetResourceWhitelistConfig).toHaveBeenCalledWith('dataset-1', {
      enabled: false,
    })
  })

  it('should wire switch, policy update, and removal mutations', async () => {
    render(<DatasetAccessConfigPage datasetId="dataset-1" />)

    mockAccessRulesEditor.props!.onAutomaticIncludeWorkspaceMembersChange!(true)
    await waitFor(() =>
      expect(mockMutations.updateAutomaticIncludeWorkspaceMembers).toHaveBeenCalledWith({
        params: { dataset_id: 'dataset-1' },
        body: { automatic_include_workspace_members: true },
      }),
    )

    mockAccessRulesEditor.props!.onUserAccessPoliciesChange!('account-1', ['policy-1'])
    await waitFor(() =>
      expect(mockMutations.updateUserAccessSettings).toHaveBeenCalledWith({
        params: { dataset_id: 'dataset-1', target_account_id: 'account-1' },
        body: { access_policy_ids: ['policy-1'] },
      }),
    )

    mockAccessRulesEditor.props!.onRemoveAccessPolicyMemberBinding!('account-3', 'policy-3')
    await waitFor(() =>
      expect(mockMutations.removeMemberBindings).toHaveBeenCalledWith({
        params: { dataset_id: 'dataset-1', policy_id: 'policy-3' },
        body: { account_ids: ['account-3'] },
      }),
    )

    const removals = [
      { accessPolicyId: 'policy-1', accountIds: ['account-1', 'account-2'] },
      { accessPolicyId: 'default', accountIds: ['account-4'] },
    ]
    await act(async () => {
      await mockAccessRulesEditor.props!.onBatchRemoveAccessPolicyMemberBindings!(removals)
    })
    expect(mockMutations.removeMemberBindings).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-1', policy_id: 'policy-1' },
      body: { account_ids: ['account-1', 'account-2'] },
    })
    expect(mockMutations.removeMemberBindings).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-1', policy_id: 'default' },
      body: { account_ids: ['account-4'] },
    })
  })

  it('should block member changes but allow permission updates during automatic inclusion', async () => {
    mockDatasetResourceWhitelistConfig.data = {
      automatic_include_workspace_members: true,
    }
    render(<DatasetAccessConfigPage datasetId="dataset-1" />)

    mockAccessRulesEditor.props!.onAddAccessSubject!('account-2', ['default'])
    mockAccessRulesEditor.props!.onRemoveAccessPolicyMemberBinding!('account-2', 'policy-1')
    await act(async () => {
      await mockAccessRulesEditor.props!.onBatchRemoveAccessPolicyMemberBindings!([
        { accessPolicyId: 'policy-1', accountIds: ['account-2'] },
      ])
    })

    expect(mockMutations.updateUserAccessSettings).not.toHaveBeenCalled()
    expect(mockMutations.removeMemberBindings).not.toHaveBeenCalled()

    mockAccessRulesEditor.props!.onUserAccessPoliciesChange!('account-2', ['policy-2'])
    await waitFor(() =>
      expect(mockMutations.updateUserAccessSettings).toHaveBeenCalledWith({
        params: { dataset_id: 'dataset-1', target_account_id: 'account-2' },
        body: { access_policy_ids: ['policy-2'] },
      }),
    )
  })
})
