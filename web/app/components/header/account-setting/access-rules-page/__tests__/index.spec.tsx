import type { AccessPolicyWithBindings } from '@/models/access-control'
import { toast } from '@langgenius/dify-ui/toast'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  useCreateAccessRule,
  useInfiniteWorkspaceAppAccessRules,
  useInfiniteWorkspaceDatasetAccessRules,
  useUpdateAccessRule,
} from '@/service/access-control/use-workspace-access-rules'
import AccessRulesPage from '../index'

const mocks = vi.hoisted(() => ({
  createAccessRule: vi.fn(),
  updateAccessRule: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/service/access-control/use-workspace-access-rules', () => ({
  workspaceAccessRulesQueryKeys: {
    app: () => ['workspace-access-rules', 'app'],
    dataset: () => ['workspace-access-rules', 'dataset'],
  },
  useCreateAccessRule: vi.fn(),
  useInfiniteWorkspaceAppAccessRules: vi.fn(),
  useInfiniteWorkspaceDatasetAccessRules: vi.fn(),
  useUpdateAccessRule: vi.fn(),
}))

vi.mock('../access-rule-section', () => ({
  default: ({
    title,
    rules,
    onCreate,
    onEditRule,
  }: {
    title: string
    rules: AccessPolicyWithBindings[]
    onCreate: () => void
    onEditRule: (rule: AccessPolicyWithBindings) => void
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
    </section>
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
    initialValues?: { name: string; description: string; permissionKeys: string[] }
    onSubmit: (values: { name: string; description: string; permissionKeys: string[] }) => void
  }) => (
    <div role="dialog" aria-label={`${resourceType} ${mode}`}>
      <span>{initialValues?.name}</span>
      <button
        type="button"
        onClick={() =>
          onSubmit({
            name: `${resourceType} permission`,
            description: `${resourceType} description`,
            permissionKeys: [`${resourceType}.acl.edit`],
          })
        }
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
  roles: [
    {
      role_id: 'role-1',
      role_name: 'Role 1',
      binding_id: 'role-binding-1',
      is_locked: false,
      role_tag: '',
    },
  ],
  accounts: [
    {
      account_id: 'member-1',
      account_name: 'Member 1',
      binding_id: 'member-binding-1',
      is_locked: false,
    },
  ],
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
  roles: [
    {
      role_id: 'dataset-role-1',
      role_name: 'Dataset Role 1',
      binding_id: 'dataset-role-binding-1',
      is_locked: false,
      role_tag: '',
    },
  ],
  accounts: [
    {
      account_id: 'dataset-member-1',
      account_name: 'Dataset Member 1',
      binding_id: 'dataset-member-binding-1',
      is_locked: false,
    },
  ],
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
  vi.mocked(useCreateAccessRule).mockReturnValue(
    mockMutation(mocks.createAccessRule) as unknown as ReturnType<typeof useCreateAccessRule>,
  )
  vi.mocked(useUpdateAccessRule).mockReturnValue(
    mockMutation(mocks.updateAccessRule) as unknown as ReturnType<typeof useUpdateAccessRule>,
  )
}

describe('AccessRulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupHooks()
  })

  it('renders app and dataset access rule sections', () => {
    render(<AccessRulesPage />)

    expect(
      screen.getByRole('heading', { name: 'permission.accessRule.appTitle' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'permission.accessRule.datasetTitle' }),
    ).toBeInTheDocument()
  })

  it('creates app permission sets with app resource type', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(
      screen.getByRole('button', { name: 'create permission.accessRule.appTitle' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'submit permission set' }))

    expect(mocks.createAccessRule).toHaveBeenCalledWith(
      {
        name: 'app permission',
        description: 'app description',
        permission_keys: ['app.acl.edit'],
        resourceType: 'app',
      },
      expect.any(Object),
    )
    expect(toast.success).toHaveBeenCalledWith('permission.accessRule.created')
  })

  it('creates dataset permission sets with dataset resource type', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(
      screen.getByRole('button', { name: 'create permission.accessRule.datasetTitle' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'submit permission set' }))

    expect(mocks.createAccessRule).toHaveBeenCalledWith(
      {
        name: 'dataset permission',
        description: 'dataset description',
        permission_keys: ['dataset.acl.edit'],
        resourceType: 'dataset',
      },
      expect.any(Object),
    )
    expect(toast.success).toHaveBeenCalledWith('permission.accessRule.created')
  })

  it('updates dataset permission sets with dataset resource type', async () => {
    render(<AccessRulesPage />)

    await userEvent.click(
      screen.getByRole('button', { name: 'edit permission.accessRule.datasetTitle' }),
    )
    expect(screen.getByText('Dataset rule')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'submit permission set' }))

    expect(mocks.updateAccessRule).toHaveBeenCalledWith(
      {
        id: 'dataset-rule-1',
        name: 'dataset permission',
        description: 'dataset description',
        permission_keys: ['dataset.acl.edit'],
        resourceType: 'dataset',
      },
      expect.any(Object),
    )
    expect(toast.success).toHaveBeenCalledWith('permission.accessRule.updated')
  })
})
