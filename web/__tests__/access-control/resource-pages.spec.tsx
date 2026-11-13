import type {
  AccessPolicy,
  ResourceUserAccessPolicies,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppAccessConfigPage from '@/app/components/app/access-config'
import ErrorBoundary from '@/app/components/base/error-boundary'
import DatasetAccessConfigPage from '@/app/components/datasets/access-config'
import DatasetDetailContext from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { AppACLPermission, DatasetACLPermission } from '@/utils/permission'

const service = vi.hoisted(() => ({
  rules: vi.fn(),
  members: vi.fn(),
  whitelist: vi.fn(),
  config: vi.fn(),
  candidates: vi.fn(),
  updateConfig: vi.fn(),
  updatePolicies: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  const queries = Object.fromEntries(
    ['apps.byAppId', 'datasets.byDatasetId'].flatMap((resource) => {
      const path = `workspaces.current.rbac.${resource}`
      return [
        [`${path}.accessPolicy.get`, service.rules],
        [`${path}.userAccessPolicies.get`, service.members],
        [`${path}.whitelist.get`, service.whitelist],
        [`${path}.whitelistConfig.get`, service.config],
      ]
    }),
  )
  const mutations = Object.fromEntries(
    ['apps.byAppId', 'datasets.byDatasetId'].flatMap((resource) => {
      const path = `workspaces.current.rbac.${resource}`
      return [
        [`${path}.whitelist.put`, service.updateConfig],
        [`${path}.users.byTargetAccountId.accessPolicies.put`, service.updatePolicies],
        [`${path}.accessPolicies.byPolicyId.memberBindings.delete`, service.remove],
      ]
    }),
  )
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      ...queries,
      'workspaces.current.members.get': service.candidates,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, mutations),
  }
})

const member = (index: number): ResourceUserAccessPolicies => ({
  account: {
    account_id: `account-${index}`,
    account_name: `Member ${index}`,
    email: `member${index}@example.com`,
  },
  roles: [],
  access_policies: [],
})
const tableName = 'permission.accessRule.allowedMembers'
const switchName = 'permission.accessRule.automaticallyIncludeWorkspaceMembers'

// Both resource pages own the same pagination/mutation contract. Exercise each real page
// and editor against request responses, including invalidation and server pagination.
describe.each(['app', 'dataset'] as const)('%s resource access page', (resource) => {
  let members: ResourceUserAccessPolicies[]
  let automaticInclusion: boolean
  let policy: AccessPolicy
  const resourceId = `${resource}-1`
  const params = { [`${resource}_id`]: resourceId }

  const renderPage = ({
    allowed = true,
    rbacEnabled = true,
    mode = 'workflow' as 'workflow' | 'agent',
    maintainerAccess = false,
  } = {}) => {
    const queryClient = createConsoleQueryClient()
    const appDetail = createAppDetailFixture({
      id: 'app-1',
      mode,
      maintainer: 'account-1',
      permission_keys: allowed && !maintainerAccess ? [AppACLPermission.AccessConfig] : [],
    })
    queryClient.setQueryData(
      consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
      appDetail,
    )
    const result = renderWithConsoleQuery(
      <DatasetDetailContext.Provider
        value={{
          dataset: createDatasetFixture({
            id: 'dataset-1',
            maintainer: 'account-1',
            permission_keys: allowed ? [DatasetACLPermission.AccessConfig] : [],
          }),
        }}
      >
        {resource === 'app' ? (
          <AppAccessConfigPage appId={resourceId} />
        ) : (
          <DatasetAccessConfigPage datasetId={resourceId} />
        )}
      </DatasetDetailContext.Provider>,
      {
        queryClient,
        systemFeatures: { rbac_enabled: rbacEnabled },
        accountProfile: { id: maintainerAccess ? 'account-1' : 'user-1' },
        workspacePermissionKeys: maintainerAccess ? ['app.create_and_management'] : [],
      },
    )
    return { ...result, appDetail }
  }

  const expectPage = async (page: number, limit = 10) => {
    await waitFor(() =>
      expect(service.members).toHaveBeenLastCalledWith({
        params,
        query: expect.objectContaining({ page, limit, reverse: false }),
      }),
    )
    await screen.findByRole('checkbox', { name: `Member ${(page - 1) * limit + 1}` })
  }

  beforeEach(() => {
    vi.resetAllMocks()
    members = Array.from({ length: 21 }, (_, index) => member(index + 1))
    automaticInclusion = false
    policy = { id: 'policy-1', name: 'Manage', resource_type: resource }
    service.rules.mockImplementation(async () => ({ items: [{ policy, roles: [], accounts: [] }] }))
    service.members.mockImplementation(async ({ query: { page, limit } }) => ({
      data: members.slice((page - 1) * limit, page * limit),
      pagination: {
        current_page: page,
        per_page: limit,
        total_count: members.length,
        total_pages: Math.ceil(members.length / limit),
      },
    }))
    // The maintainer may be implicitly included and absent from the whitelist.
    service.whitelist.mockImplementation(async () => ({
      account_ids: members.slice(1).map((item) => item.account.account_id),
    }))
    service.config.mockImplementation(async () => ({
      automatic_include_workspace_members: automaticInclusion,
    }))
    service.candidates.mockResolvedValue({
      accounts: Array.from({ length: 22 }, (_, index) => ({
        id: `account-${index + 1}`,
        name: `Member ${index + 1}`,
        email: `member${index + 1}@example.com`,
        avatar: '',
        avatar_url: '',
        status: 'active',
        role: 'normal',
        roles: [],
      })),
    })
    service.updateConfig.mockImplementation(async ({ body }) => {
      automaticInclusion = body.automatic_include_workspace_members
      return {}
    })
    service.updatePolicies.mockImplementation(async ({ params: inputParams, body }) => {
      const id = inputParams.target_account_id
      let setting = members.find((item) => item.account.account_id === id)
      if (!setting) {
        setting = member(Number(id.split('-')[1]))
        members.push(setting)
      }
      members = members.map((item) =>
        item.account.account_id === id
          ? { ...item, access_policies: body.access_policy_ids.includes(policy.id) ? [policy] : [] }
          : item,
      )
      return {}
    })
    service.remove.mockImplementation(async ({ body }) => {
      members = members.filter((item) => !body.account_ids.includes(item.account.account_id))
      return {}
    })
  })

  it('shows the server page and keeps the maintainer protected', async () => {
    automaticInclusion = true
    renderPage()
    await expectPage(1)
    expect(
      screen.getByRole('heading', { name: 'navigation.settings.resourceAccess' }),
    ).toBeVisible()
    expect(screen.getByRole('switch', { name: switchName })).toBeChecked()
    const row = screen.getByRole('row', { name: /Member 1\b/ })
    expect(within(row).getByText('permission.accessRule.maintainer')).toBeVisible()
    expect(within(row).getByRole('button', { name: 'common.operation.remove' })).toBeDisabled()
    expect(screen.queryByRole('checkbox', { name: 'Member 11' })).not.toBeInTheDocument()
  })

  it('requests another page and resets to the first page when page size changes', async () => {
    const user = userEvent.setup()
    renderPage()
    await expectPage(1)
    await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    await expectPage(2)
    await user.click(screen.getByRole('radio', { name: '25' }))
    await expectPage(1, 25)
    expect(screen.getByRole('radio', { name: '25' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Member 21' })).toBeInTheDocument()
  })

  it('persists automatic inclusion and returns to the first page when it is disabled', async () => {
    const user = userEvent.setup()
    automaticInclusion = true
    renderPage()
    await expectPage(1)
    await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    await expectPage(2)
    await user.click(screen.getByRole('switch', { name: switchName }))
    await waitFor(() =>
      expect(service.updateConfig).toHaveBeenCalledWith({
        params,
        body: { automatic_include_workspace_members: false },
      }),
    )
    await expectPage(1)
    expect(screen.getByRole('switch', { name: switchName })).not.toBeChecked()
  })

  it('adds a candidate and displays the new last page using the server total', async () => {
    const user = userEvent.setup()
    members = members.slice(0, 10)
    renderPage()
    await expectPage(1)
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'permission.accessRule.addMembersTitle',
    })
    expect(
      await within(dialog).findByRole('menuitem', { name: /Member 1 member1@/ }),
    ).toHaveAttribute('aria-disabled', 'true')
    await user.click(within(dialog).getByRole('menuitem', { name: /Member 11 member11@/ }))
    await waitFor(() =>
      expect(service.updatePolicies).toHaveBeenCalledWith({
        params: { ...params, target_account_id: 'account-11' },
        body: { access_policy_ids: ['default'] },
      }),
    )
    await expectPage(2)
  })

  it.each(['single', 'batch'] as const)(
    'returns to the previous page after %s removal empties the last page',
    async (removal) => {
      const user = userEvent.setup()
      members = members.slice(0, removal === 'single' ? 11 : 12)
      renderPage()
      await expectPage(1)
      await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
      await expectPage(2)
      if (removal === 'single') {
        await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      } else {
        await user.click(screen.getByRole('checkbox', { name: 'common.operation.selectAll' }))
        await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
        await user.click(
          within(screen.getByRole('alertdialog')).getByRole('button', {
            name: 'common.operation.sure',
          }),
        )
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      }
      await waitFor(() =>
        expect(service.remove).toHaveBeenCalledWith({
          params: { ...params, policy_id: 'default' },
          body: {
            account_ids: removal === 'single' ? ['account-11'] : ['account-11', 'account-12'],
          },
        }),
      )
      await expectPage(1)
      expect(screen.queryByRole('checkbox', { name: 'Member 11' })).not.toBeInTheDocument()
    },
  )

  it('blocks membership changes during automatic inclusion while still saving a policy change', async () => {
    const user = userEvent.setup()
    automaticInclusion = true
    renderPage()
    await expectPage(1)
    expect(screen.getByRole('button', { name: 'common.operation.add' })).toBeDisabled()
    const row = screen.getByRole('row', { name: /Member 2 member2@/ })
    expect(within(row).getByRole('button', { name: 'common.operation.remove' })).toBeDisabled()
    expect(within(row).getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true')
    await user.click(within(row).getByLabelText(/permission\.accessRule\.exceptionPermissionFor/))
    await user.click(await screen.findByRole('option', { name: 'Manage' }))
    await waitFor(() =>
      expect(service.updatePolicies).toHaveBeenCalledWith({
        params: { ...params, target_account_id: 'account-2' },
        body: { access_policy_ids: ['policy-1'] },
      }),
    )
    await waitFor(() =>
      expect(
        within(row).getByLabelText(/permission\.accessRule\.exceptionPermissionFor/),
      ).toHaveTextContent('Manage'),
    )
    expect(service.remove).not.toHaveBeenCalled()
  })

  it('keeps the inclusion switch checked while the separate candidate whitelist is loading', async () => {
    automaticInclusion = true
    service.whitelist.mockImplementation(() => new Promise(() => {}))
    renderPage()
    await expectPage(1)
    expect(screen.getByRole('switch', { name: switchName })).toBeChecked()
  })

  it.each([{ allowed: false }, { rbacEnabled: false }])(
    'does not fetch access data when access is unavailable: %j',
    async (options) => {
      renderPage(options)
      await act(async () => {})
      expect(screen.queryByRole('table', { name: tableName })).not.toBeInTheDocument()
      expect(service.rules).not.toHaveBeenCalled()
      expect(service.members).not.toHaveBeenCalled()
      expect(service.whitelist).not.toHaveBeenCalled()
      expect(service.config).not.toHaveBeenCalled()
    },
  )

  if (resource === 'app') {
    it('does not fetch access data for Agent apps', async () => {
      renderPage({ mode: 'agent' })
      await act(async () => {})
      expect(screen.queryByRole('table', { name: tableName })).not.toBeInTheDocument()
      expect(service.rules).not.toHaveBeenCalled()
      expect(service.members).not.toHaveBeenCalled()
    })

    it('allows the maintainer with workspace app-management permission', async () => {
      renderPage({ maintainerAccess: true })
      await expectPage(1)
      expect(screen.getByRole('table', { name: tableName })).toBeVisible()
    })

    it('preserves the page across metadata refresh and removes access after permission revocation', async () => {
      const user = userEvent.setup()
      const { queryClient, appDetail } = renderPage()
      const key = consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } })
      await expectPage(1)
      await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
      await expectPage(2)
      act(() => queryClient.setQueryData(key, { ...appDetail, maintainer: 'account-11' }))
      const row = screen.getByRole('row', { name: /Member 11 member11@/ })
      await waitFor(() =>
        expect(within(row).getByText('permission.accessRule.maintainer')).toBeVisible(),
      )
      expect(within(row).getByRole('button', { name: 'common.operation.remove' })).toBeDisabled()
      act(() => queryClient.setQueryData(key, { ...appDetail, permission_keys: [] }))
      await waitFor(() =>
        expect(screen.queryByRole('table', { name: tableName })).not.toBeInTheDocument(),
      )
    })

    it('surfaces an initial app-detail failure before requesting access data', async () => {
      const queryClient = createConsoleQueryClient()
      const queryKey = consoleQuery.apps.byAppId.get.queryKey({
        input: { params: { app_id: 'unavailable-app' } },
      })
      queryClient.setQueryDefaults(queryKey, { retryOnMount: false })
      await queryClient
        .query({ queryKey, queryFn: () => Promise.reject(new Error('Detail unavailable')) })
        .catch(() => {})
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        renderWithConsoleQuery(
          <ErrorBoundary>
            <AppAccessConfigPage appId="unavailable-app" />
          </ErrorBoundary>,
          { queryClient },
        )
        expect(
          await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' }),
        ).toBeVisible()
        expect(service.rules).not.toHaveBeenCalled()
        expect(service.members).not.toHaveBeenCalled()
      } finally {
        consoleError.mockRestore()
      }
    })
  }
})
