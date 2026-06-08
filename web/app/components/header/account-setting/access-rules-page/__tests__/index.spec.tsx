import type { AccessPolicyWithBindings, RemoveBindingPayload } from '@/models/access-control'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  useBindingLock,
  useBindingUnlock,
  useCreateAccessRule,
  useInfiniteWorkspaceAppAccessRules,
  useInfiniteWorkspaceDatasetAccessRules,
  useUpdateAccessRule,
  useUpdateAppAccessRuleBindings,
  useUpdateDatasetAccessRuleBindings,
} from '@/service/access-control/use-workspace-access-rules'
import AccessRulesPage from '../index'

const mocks = vi.hoisted(() => ({
  createAccessRule: vi.fn(),
  bindingLock: vi.fn(),
  bindingUnlock: vi.fn(),
  updateAccessRule: vi.fn(),
  updateAppAccessRuleBindings: vi.fn(),
  updateDatasetAccessRuleBindings: vi.fn(),
  setQueriesData: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')

  return {
    ...actual,
    useQueryClient: vi.fn(),
  }
})

vi.mock('@/service/access-control/use-workspace-access-rules', () => ({
  workspaceAccessRulesQueryKeys: {
    app: () => ['workspace-access-rules', 'app'],
    dataset: () => ['workspace-access-rules', 'dataset'],
  },
  useBindingLock: vi.fn(),
  useBindingUnlock: vi.fn(),
  useCreateAccessRule: vi.fn(),
  useInfiniteWorkspaceAppAccessRules: vi.fn(),
  useInfiniteWorkspaceDatasetAccessRules: vi.fn(),
  useUpdateAccessRule: vi.fn(),
  useUpdateAppAccessRuleBindings: vi.fn(),
  useUpdateDatasetAccessRuleBindings: vi.fn(),
}))

vi.mock('../access-rule-section', () => ({
  default: ({
    title,
    rules,
    onCreate,
    onEditRule,
    onAddRole,
    onRemoveBinding,
    onToggleLockStatus,
  }: {
    title: string
    rules: AccessPolicyWithBindings[]
    onCreate: () => void
    onEditRule: (rule: AccessPolicyWithBindings) => void
    onAddRole: (rule: AccessPolicyWithBindings) => void
    onRemoveBinding: (payload: RemoveBindingPayload) => void
    onToggleLockStatus?: (bindingId: string, newStatus: boolean) => void
  }) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      <button type="button" aria-label={`create ${title}`} onClick={onCreate}>
        create
        {title}
      </button>
      <button type="button" aria-label={`edit ${title}`} onClick={() => onEditRule(rules[0]!)}>
        edit
        {title}
      </button>
      <button type="button" aria-label={`add targets ${title}`} onClick={() => onAddRole(rules[0]!)}>
        add targets
        {title}
      </button>
      <button
        type="button"
        aria-label={`remove binding ${title}`}
        onClick={() => onRemoveBinding({
          policy_id: rules[0]!.policy.id,
          resource_type: rules[0]!.policy.resource_type,
          role_ids: ['role-next'],
          account_ids: ['account-next'],
        })}
      >
        remove binding
        {' '}
        {title}
      </button>
      <button
        type="button"
        aria-label={`lock binding ${title}`}
        onClick={() => onToggleLockStatus?.(rules[0]!.roles[0]!.binding_id, true)}
      >
        lock binding
        {' '}
        {title}
      </button>
      <button
        type="button"
        aria-label={`unlock binding ${title}`}
        onClick={() => onToggleLockStatus?.(rules[0]!.accounts[0]!.binding_id, false)}
      >
        unlock binding
        {' '}
        {title}
      </button>
    </section>
  ),
}))

vi.mock('../add-rule-targets-modal', () => ({
  default: ({
    ruleName,
    initialRoleIds,
    initialMemberIds,
    onSubmit,
  }: {
    ruleName: string
    initialRoleIds: string[]
    initialMemberIds: string[]
    onSubmit: (selection: { roleIds: string[], memberIds: string[] }) => void
  }) => (
    <div role="dialog" aria-label={`targets ${ruleName}`}>
      <span>{initialRoleIds.join(',')}</span>
      <span>{initialMemberIds.join(',')}</span>
      <button
        type="button"
        onClick={() => onSubmit({
          roleIds: ['role-2'],
          memberIds: ['member-2'],
        })}
      >
        submit targets
      </button>
    </div>
  ),
}))

vi.mock('../permission-set-modal', () => ({
  default: ({
    mode,
    resourceType,
    initialValues,
    onSubmit,
  }: {
    mode: string
    resourceType: string
    initialValues?: { name: string, description: string, permissionKeys: string[] }
    onSubmit: (values: { name: string, description: string, permissionKeys: string[] }) => void
  }) => (
    <div role="dialog" aria-label={`${resourceType} ${mode}`}>
      <span>{initialValues?.name}</span>
      <button
        type="button"
        onClick={() => onSubmit({
          name: `${resourceType} permission`,
          description: `${resourceType} description`,
          permissionKeys: [`${resourceType}.acl.edit`],
        })}
      >
        submit permission set
      </button>
    </div>
  ),
}))

const appRule: AccessPolicyWithBindings = {
  policy: {
    id: 'app-rule-1',
    tenant_id: 'tenant-1',
    resource_type: 'app',
    policy_key: 'app-rule',
    name: 'App rule',
    description: 'App rule description',
    permission_keys: ['app.acl.edit'],
    is_builtin: false,
    category: 'global_custom',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  roles: [{
    role_id: 'role-1',
    role_name: 'Role 1',
    binding_id: 'role-binding-1',
    is_locked: false,
  }],
  accounts: [{
    account_id: 'member-1',
    account_name: 'Member 1',
    binding_id: 'member-binding-1',
    is_locked: false,
  }],
}

const datasetRule: AccessPolicyWithBindings = {
  policy: {
    ...appRule.policy,
    id: 'dataset-rule-1',
    resource_type: 'dataset',
    policy_key: 'dataset-rule',
    name: 'Dataset rule',
    permission_keys: ['dataset.acl.edit'],
  },
  roles: [{
    role_id: 'dataset-role-1',
    role_name: 'Dataset Role 1',
    binding_id: 'dataset-role-binding-1',
    is_locked: false,
  }],
  accounts: [{
    account_id: 'dataset-member-1',
    account_name: 'Dataset Member 1',
    binding_id: 'dataset-member-binding-1',
    is_locked: false,
  }],
}

const mockMutation = (mock: ReturnType<typeof vi.fn>) => {
  mock.mockImplementation((_payload, options) => {
    options?.onSuccess?.()
    return Promise.resolve()
  })

  return {
    mutate: mock,
    mutateAsync: mock,
  }
}

const pagination = {
  total_count: 1,
  per_page: 20,
  current_page: 1,
  total_pages: 1,
}

const setupHooks = () => {
  vi.mocked(useQueryClient).mockReturnValue({
    setQueriesData: mocks.setQueriesData,
  } as unknown as ReturnType<typeof useQueryClient>)
  vi.mocked(useInfiniteWorkspaceAppAccessRules).mockReturnValue({
    data: { pages: [{ items: [appRule], pagination }], pageParams: [1] },
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    error: null,
  } as unknown as ReturnType<typeof useInfiniteWorkspaceAppAccessRules>)
  vi.mocked(useInfiniteWorkspaceDatasetAccessRules).mockReturnValue({
    data: { pages: [{ items: [datasetRule], pagination }], pageParams: [1] },
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    error: null,
  } as unknown as ReturnType<typeof useInfiniteWorkspaceDatasetAccessRules>)
  vi.mocked(useBindingLock).mockReturnValue(mockMutation(mocks.bindingLock) as unknown as ReturnType<typeof useBindingLock>)
  vi.mocked(useBindingUnlock).mockReturnValue(mockMutation(mocks.bindingUnlock) as unknown as ReturnType<typeof useBindingUnlock>)
  vi.mocked(useCreateAccessRule).mockReturnValue(mockMutation(mocks.createAccessRule) as unknown as ReturnType<typeof useCreateAccessRule>)
  vi.mocked(useUpdateAccessRule).mockReturnValue(mockMutation(mocks.updateAccessRule) as unknown as ReturnType<typeof useUpdateAccessRule>)
  vi.mocked(useUpdateAppAccessRuleBindings).mockReturnValue(mockMutation(mocks.updateAppAccessRuleBindings) as unknown as ReturnType<typeof useUpdateAppAccessRuleBindings>)
  vi.mocked(useUpdateDatasetAccessRuleBindings).mockReturnValue(mockMutation(mocks.updateDatasetAccessRuleBindings) as unknown as ReturnType<typeof useUpdateDatasetAccessRuleBindings>)
}

describe('AccessRulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupHooks()
  })

  it('renders app and dataset access rule sections', () => {
    render(<AccessRulesPage />)

    expect(screen.getByRole('heading', { name: 'permission.accessRule.appTitle' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'permission.accessRule.datasetTitle' })).toBeInTheDocument()
  })

  it('creates app permission sets with app resource type', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(screen.getByRole('button', { name: 'create permission.accessRule.appTitle' }))
    await userEvent.click(screen.getByRole('button', { name: 'submit permission set' }))

    expect(mocks.createAccessRule).toHaveBeenCalledWith({
      name: 'app permission',
      description: 'app description',
      permission_keys: ['app.acl.edit'],
      resourceType: 'app',
    }, expect.any(Object))
    expect(toast.success).toHaveBeenCalledWith('permission.accessRule.created')
  })

  it('updates dataset permission sets with dataset resource type', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(screen.getByRole('button', { name: 'edit permission.accessRule.datasetTitle' }))
    expect(screen.getByText('Dataset rule')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'submit permission set' }))

    expect(mocks.updateAccessRule).toHaveBeenCalledWith({
      id: 'dataset-rule-1',
      name: 'dataset permission',
      description: 'dataset description',
      permission_keys: ['dataset.acl.edit'],
      resourceType: 'dataset',
    }, expect.any(Object))
    expect(toast.success).toHaveBeenCalledWith('permission.accessRule.updated')
  })

  it('updates binding targets for the selected app rule', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(screen.getByRole('button', { name: 'add targets permission.accessRule.appTitle' }))
    expect(screen.getByRole('dialog', { name: 'targets App rule' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'submit targets' }))

    expect(mocks.updateAppAccessRuleBindings).toHaveBeenCalledWith({
      id: 'app-rule-1',
      role_ids: ['role-2'],
      account_ids: ['member-2'],
    }, expect.any(Object))
  })

  it('removes dataset rule bindings through dataset binding mutation', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(screen.getByRole('button', { name: 'remove binding permission.accessRule.datasetTitle' }))

    expect(mocks.updateDatasetAccessRuleBindings).toHaveBeenCalledWith({
      id: 'dataset-rule-1',
      role_ids: ['role-next'],
      account_ids: ['account-next'],
    }, expect.any(Object))
  })

  it('locks app bindings and updates only the matching cached binding', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(screen.getByRole('button', { name: 'lock binding permission.accessRule.appTitle' }))

    expect(mocks.bindingLock).toHaveBeenCalledWith('role-binding-1', expect.any(Object))
    expect(mocks.setQueriesData).toHaveBeenCalledWith({
      queryKey: ['workspace-access-rules', 'app'],
    }, expect.any(Function))

    const updateCachedRules = mocks.setQueriesData.mock.calls[0]![1] as (data: {
      pages: Array<{ items: AccessPolicyWithBindings[], pagination: typeof pagination }>
      pageParams: number[]
    }) => {
      pages: Array<{ items: AccessPolicyWithBindings[], pagination: typeof pagination }>
      pageParams: number[]
    }
    const cachedRole = { ...appRule.roles[0]!, is_locked: false }
    const cachedAccount = { ...appRule.accounts[0]!, is_locked: false }
    const cachedRule = {
      ...appRule,
      roles: [cachedRole],
      accounts: [cachedAccount],
    }
    const cachedData = {
      pages: [{ items: [cachedRule], pagination }],
      pageParams: [1],
    }

    const updatedData = updateCachedRules(cachedData)

    expect(updatedData.pages[0]!.items[0]!.roles[0]!.is_locked).toBe(true)
    expect(updatedData.pages[0]!.items[0]!.accounts[0]).toBe(cachedAccount)
  })

  it('unlocks app bindings through the unlock mutation', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(screen.getByRole('button', { name: 'unlock binding permission.accessRule.appTitle' }))

    expect(mocks.bindingUnlock).toHaveBeenCalledWith('member-binding-1', expect.any(Object))
  })

  it('locks dataset bindings and updates only the matching cached binding', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(screen.getByRole('button', { name: 'lock binding permission.accessRule.datasetTitle' }))

    expect(mocks.bindingLock).toHaveBeenCalledWith('dataset-role-binding-1', expect.any(Object))
    expect(mocks.setQueriesData).toHaveBeenCalledWith({
      queryKey: ['workspace-access-rules', 'dataset'],
    }, expect.any(Function))

    const updateCachedRules = mocks.setQueriesData.mock.calls[0]![1] as (data: {
      pages: Array<{ items: AccessPolicyWithBindings[], pagination: typeof pagination }>
      pageParams: number[]
    }) => {
      pages: Array<{ items: AccessPolicyWithBindings[], pagination: typeof pagination }>
      pageParams: number[]
    }
    const cachedRole = { ...datasetRule.roles[0]!, is_locked: false }
    const cachedAccount = { ...datasetRule.accounts[0]!, is_locked: false }
    const cachedRule = {
      ...datasetRule,
      roles: [cachedRole],
      accounts: [cachedAccount],
    }
    const cachedData = {
      pages: [{ items: [cachedRule], pagination }],
      pageParams: [1],
    }

    const updatedData = updateCachedRules(cachedData)

    expect(updatedData.pages[0]!.items[0]!.roles[0]!.is_locked).toBe(true)
    expect(updatedData.pages[0]!.items[0]!.accounts[0]).toBe(cachedAccount)
  })
})
