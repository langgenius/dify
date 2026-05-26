import type { AccessPolicyWithBindings, RemoveBindingPayload } from '@/models/access-control'
import { toast } from '@langgenius/dify-ui/toast'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  useCreateAccessRule,
  useUpdateAccessRule,
  useUpdateAppAccessRuleBindings,
  useUpdateDatasetAccessRuleBindings,
  useWorkspaceAppAccessRules,
  useWorkspaceDatasetAccessRules,
} from '@/service/access-control/use-workspace-access-rules'
import AccessRulesPage from '../index'

const mocks = vi.hoisted(() => ({
  createAccessRule: vi.fn(),
  updateAccessRule: vi.fn(),
  updateAppAccessRuleBindings: vi.fn(),
  updateDatasetAccessRuleBindings: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/service/access-control/use-workspace-access-rules', () => ({
  useWorkspaceAppAccessRules: vi.fn(),
  useWorkspaceDatasetAccessRules: vi.fn(),
  useCreateAccessRule: vi.fn(),
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
  }: {
    title: string
    rules: AccessPolicyWithBindings[]
    onCreate: () => void
    onEditRule: (rule: AccessPolicyWithBindings) => void
    onAddRole: (rule: AccessPolicyWithBindings) => void
    onRemoveBinding: (payload: RemoveBindingPayload) => void
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
  roles: [{ role_id: 'role-1', role_name: 'Role 1' }],
  accounts: [{ account_id: 'member-1', account_name: 'Member 1' }],
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
  roles: [{ role_id: 'dataset-role-1', role_name: 'Dataset Role 1' }],
  accounts: [{ account_id: 'dataset-member-1', account_name: 'Dataset Member 1' }],
}

const mockMutation = (mock: ReturnType<typeof vi.fn>) => {
  mock.mockImplementation((_payload, options) => {
    options?.onSuccess?.()
    return Promise.resolve()
  })

  return { mutateAsync: mock }
}

const setupHooks = () => {
  vi.mocked(useWorkspaceAppAccessRules).mockReturnValue({
    data: { items: [appRule] },
    isLoading: false,
  } as ReturnType<typeof useWorkspaceAppAccessRules>)
  vi.mocked(useWorkspaceDatasetAccessRules).mockReturnValue({
    data: { items: [datasetRule] },
    isLoading: false,
  } as ReturnType<typeof useWorkspaceDatasetAccessRules>)
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
})
