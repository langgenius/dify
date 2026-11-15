import type { ReactElement } from 'react'
import type { AccessRule } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AccessRuleSection from '../access-rule-section'

let workspacePermissionKeys: string[] = []
const render = (ui: ReactElement) => renderWithConsoleQuery(ui, { workspacePermissionKeys })

const rule: AccessRule = {
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
    created_at: 1767225600,
    updated_at: 1767225600,
  },
  roles: [
    {
      role_id: 'role-1',
      role_name: 'Admin',
      binding_id: 'role-binding-1',
      is_locked: true,
      role_tag: '',
    },
  ],
  accounts: [
    {
      account_id: 'account-1',
      account_name: 'Levi',
      avatar: '',
      email: 'levi@example.com',
      binding_id: 'account-binding-1',
      is_locked: false,
    },
  ],
}

let intersectionObserverCallback: IntersectionObserverCallback | null = null

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersectionObserverCallback = callback
  }

  observe = vi.fn()
  disconnect = vi.fn()
}

describe('AccessRuleSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspacePermissionKeys = []
    intersectionObserverCallback = null
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('should render a collapsed group and expand it when the header is clicked', async () => {
    const user = userEvent.setup()
    render(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={1}
        isLoadingRules={false}
      />,
    )

    expect(screen.queryByText('Full Control')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^App Access Rules/ }))

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
        rules={[
          {
            ...rule,
            policy: {
              ...rule.policy,
              description: '',
            },
          },
        ]}
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
    const user = userEvent.setup()
    workspacePermissionKeys = ['workspace.role.manage']
    const onCreate = vi.fn()

    render(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={1}
        isLoadingRules={false}
        onCreate={onCreate}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /permission\.accessRule\.newPermissionSet/ }),
    )

    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('opens the built-in rule through its authorized row action', async () => {
    const user = userEvent.setup()
    const onViewRule = vi.fn()
    workspacePermissionKeys = ['workspace.role.manage']

    render(
      <AccessRuleSection
        title="App Access Rules"
        rules={[rule]}
        totalCount={1}
        isLoadingRules={false}
        onViewRule={onViewRule}
        defaultExpanded
      />,
    )

    const trigger = screen.getByRole('button', { name: 'common.operation.moreActions' })

    await user.click(trigger)

    await user.click(screen.getByRole('menuitem', { name: 'common.operation.view' }))
    expect(onViewRule).toHaveBeenCalledExactlyOnceWith(rule)
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

    expect(
      screen.queryByRole('button', { name: /permission\.accessRule\.newPermissionSet/ }),
    ).not.toBeInTheDocument()
  })
})
