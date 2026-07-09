import type { ReactNode } from 'react'
import type { AccessPolicyWithBindings } from '@/models/access-control'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccessRuleSection from '../access-rule-section'

const mocks = vi.hoisted(() => ({
  workspacePermissionKeys: [] as string[],
}))

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mocks.workspacePermissionKeys,
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mocks.workspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mocks.workspacePermissionKeys,
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mocks.workspacePermissionKeys,
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mocks.workspacePermissionKeys,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

const rule: AccessPolicyWithBindings = {
  policy: {
    id: 'app-rule-1',
    tenant_id: 'tenant-1',
    resource_type: 'app',
    policy_key: 'app-rule',
    name: 'Full Control',
    description: 'Can edit and publish apps.',
    permission_keys: ['app.edit'],
    is_builtin: true,
    category: 'global_system_default',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  roles: [{
    role_id: 'role-1',
    role_name: 'Admin',
    binding_id: 'role-binding-1',
    is_locked: true,
    role_tag: '',
  }],
  accounts: [{
    account_id: 'account-1',
    account_name: 'Levi',
    binding_id: 'account-binding-1',
    is_locked: false,
  }],
}

let intersectionObserverCallback: IntersectionObserverCallback | null = null

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersectionObserverCallback = callback
  }

  observe = vi.fn()
  disconnect = vi.fn()
}

const renderWithQueryClient = (children: ReactNode) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>,
  )
}

describe('AccessRuleSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspacePermissionKeys = []
    intersectionObserverCallback = null
    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
  })

  it('should render a collapsed group and expand it when the header is clicked', async () => {
    render(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={1}
        isLoadingRules={false}
      />,
    )

    expect(screen.queryByText('Full Control')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('Full Control')).toBeInTheDocument()
  })

  it('should summarize total permission sets without binding counts', () => {
    render(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={2}
        isLoadingRules={false}
      />,
    )

    expect(screen.getByText(/permission\.accessRule\.summary/)).toHaveTextContent('"count":2')
    expect(screen.queryByText(/permission\.accessRule\.lockedSummary/)).not.toBeInTheDocument()
  })

  it('should render a placeholder when a rule has no description', () => {
    render(
      <AccessRuleSection
        title="App Access Rules"
        rules={[{
          ...rule,
          policy: {
            ...rule.policy,
            description: '',
          },
        }]}
        totalCount={1}
        isLoadingRules={false}
        defaultExpanded
      />,
    )

    expect(screen.getByText('permission.accessRule.noDescription')).toBeInTheDocument()
  })

  it('should fetch the next page when the expanded group reaches its list anchor', () => {
    const fetchNextPage = vi.fn()

    render(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={2}
        isLoadingRules={false}
        hasNextPage
        fetchNextPage={fetchNextPage}
        defaultExpanded
      />,
    )

    intersectionObserverCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('should not fetch more while a next page is already loading', () => {
    const fetchNextPage = vi.fn()

    render(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={2}
        isLoadingRules={false}
        isFetchingNextPage
        hasNextPage
        fetchNextPage={fetchNextPage}
        defaultExpanded
      />,
    )

    intersectionObserverCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )

    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('should expose create action when workspace role management is allowed', async () => {
    mocks.workspacePermissionKeys = ['workspace.role.manage']
    const onCreate = vi.fn()

    renderWithQueryClient(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={1}
        isLoadingRules={false}
        onCreate={onCreate}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /permission\.accessRule\.newPermissionSet/ }))

    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('should keep row actions when workspace role management is allowed', () => {
    mocks.workspacePermissionKeys = ['workspace.role.manage']

    renderWithQueryClient(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={1}
        isLoadingRules={false}
        defaultExpanded
      />,
    )

    expect(screen.getByRole('button', { name: 'common.operation.moreActions' })).toBeInTheDocument()
  })

  it('should hide create action when workspace role management is missing', () => {
    render(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={1}
        isLoadingRules={false}
      />,
    )

    expect(screen.queryByRole('button', { name: /permission\.accessRule\.newPermissionSet/ })).not.toBeInTheDocument()
  })
})
