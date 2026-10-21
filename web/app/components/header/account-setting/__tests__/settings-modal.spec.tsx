import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQueryState } from 'nuqs'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { ACCOUNT_SETTING_TAB as TAB } from '../constants'
import { settingsQueryParamName, settingsQueryParser } from '../query-params'
import { SettingsModal } from '../settings-modal'

const featureFlags = vi.hoisted(() => ({ NEXT_PUBLIC_ENABLE_ACCESS_TOKEN: true }))
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      get NEXT_PUBLIC_ENABLE_ACCESS_TOKEN() {
        return featureFlags.NEXT_PUBLIC_ENABLE_ACCESS_TOKEN
      },
    },
  }
})
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  const emptyPolicies = async () => ({
    items: [],
    pagination: { current_page: 1, total_pages: 1, total_count: 0, per_page: 20 },
  })
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.networkAccessGroups.get': async () => ({
        tenant_id: 'workspace-1',
        entitled: true,
        groups: [],
      }),
      'workspaces.current.members.get': async () => ({ accounts: [] }),
      'features.vectorSpace.get': async () => ({ size: 0, limit: 50, usage_unknown: false }),
      'billing.invoices.get': async () => ({ url: 'https://billing.example.com' }),
      'workspaces.customConfig.get': async () => ({
        remove_webapp_brand: false,
        replace_webapp_logo: null,
      }),
      'workspaces.current.rbac.roles.get': async () => ({
        data: [],
        pagination: { current_page: 1, total_pages: 1, total_count: 0, per_page: 20 },
      }),
      'workspaces.current.rbac.workspace.apps.accessPolicy.get': emptyPolicies,
      'workspaces.current.rbac.workspace.datasets.accessPolicy.get': emptyPolicies,
      'workspaces.current.rbac.workspace.agents.accessPolicy.get': emptyPolicies,
      'resourceAccessTokens.get': async () => ({ data: [], total: 0, page: 1, limit: 20 }),
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
    }),
  }
})

function PreferencesOpener() {
  const [destination, setDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)
  return (
    <button
      type="button"
      aria-pressed={destination === TAB.PREFERENCES}
      onClick={() => setDestination(TAB.PREFERENCES)}
    >
      Open preferences
    </button>
  )
}

function renderSettings(
  destination: string | null = TAB.MEMBERS,
  options: ConsoleQueryTestOptions = {},
) {
  const { wrapper: UrlProvider, onUrlUpdate } = createNuqsTestWrapper({
    searchParams: destination === null ? '?keep=value' : `?keep=value&settings=${destination}`,
    hasMemory: true,
  })
  const rendered = renderWithConsoleQuery(
    <UrlProvider>
      <PreferencesOpener />
      <SettingsModal />
    </UrlProvider>,
    {
      ...options,
      currentWorkspace: { role: 'owner', ...options.currentWorkspace },
      workspacePermissionKeys: options.workspacePermissionKeys ?? [
        'workspace.member.manage',
        'workspace.role.manage',
        'customization.manage',
      ],
      features: {
        billing: { subscription: { plan: 'sandbox' } },
        can_replace_logo: true,
        ...options.features,
      },
      systemFeatures: {
        deployment_edition: 'CLOUD',
        rbac_enabled: true,
        ...options.systemFeatures,
      },
    },
  )
  return { ...rendered, onUrlUpdate }
}

const findSettings = async () => {
  // The settings surface is lazy; finish loading it before starting the DOM query timeout.
  await act(async () => vi.dynamicImportSettled())
  return screen.findByRole('dialog', { name: 'navigation.settings.settings' })
}
const expectMembers = () =>
  screen.findByRole('columnheader', { name: 'workspaceMembers.members.name' })

beforeEach(() => {
  featureFlags.NEXT_PUBLIC_ENABLE_ACCESS_TOKEN = true
})

it('opens preferences from the URL control, switches real pages, and closes with shallow replace updates', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate } = renderSettings(null)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Open preferences' }))
  await act(async () => vi.dynamicImportSettled())
  const dialog = await findSettings()
  expect(within(dialog).getByText('accountSettings.account.appearanceLabel')).toBeInTheDocument()
  expect(onUrlUpdate.mock.lastCall?.[0]).toMatchObject({
    options: { history: 'replace', shallow: true },
  })

  const destinations = [
    {
      name: 'navigation.settings.members',
      tab: TAB.MEMBERS,
      content: 'workspaceMembers.members.name',
    },
    {
      name: 'navigation.settings.rolesAndPermissions',
      tab: TAB.ROLES_AND_PERMISSIONS,
      content: 'permission.role.workspaceRoles.title',
    },
    {
      name: 'navigation.settings.permissionSet',
      tab: TAB.PERMISSION_SET,
      content: 'permission.accessRule.appTitle',
    },
    {
      name: 'navigation.settings.accessToken',
      tab: TAB.ACCESS_TOKEN,
      content: 'accountSettings.resourceAccessToken.empty',
    },
    {
      name: 'navigation.settings.billing',
      tab: TAB.BILLING,
      content: 'billing.plans.sandbox.name',
    },
    { name: 'custom.custom', tab: TAB.CUSTOM, content: 'custom.webapp.changeLogo' },
    {
      name: 'appLog.archives.title',
      tab: TAB.WORKFLOW_LOG_ARCHIVES,
      content: 'appLog.archives.upgradeTip.title',
    },
  ]
  for (const { name, tab, content } of destinations) {
    await user.click(within(dialog).getByRole('button', { name }))
    expect(await within(dialog).findByText(content)).toBeInTheDocument()
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe(tab),
    )
  }
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  const update = onUrlUpdate.mock.lastCall?.[0]
  expect(update?.searchParams.has('settings')).toBe(false)
  expect(update?.searchParams.get('keep')).toBe('value')
  expect(update?.options).toMatchObject({ history: 'replace', shallow: true })
})

it('opens workspace usage limits from the settings navigation', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate } = renderSettings(TAB.MEMBERS, {
    currentWorkspace: { max_active_requests: 5 },
  })
  const dialog = await findSettings()

  await user.click(within(dialog).getByRole('button', { name: 'navigation.settings.usageLimits' }))

  expect(
    await within(dialog).findByRole('spinbutton', {
      name: 'common.usageLimits.maxActiveRequests.label',
    }),
  ).toHaveValue(5)
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe(TAB.USAGE_LIMITS),
  )
})

it.each([
  {
    reason: 'RBAC is disabled',
    tab: TAB.PERMISSION_SET,
    options: { systemFeatures: { rbac_enabled: false } },
  },
  {
    reason: 'role management permission is missing',
    tab: TAB.ROLES_AND_PERMISSIONS,
    options: { workspacePermissionKeys: [] },
  },
])(
  'hides role navigation and renders members for a direct role destination when $reason',
  async ({ tab, options }) => {
    renderSettings(tab, options)
    const dialog = await findSettings()
    expect(await expectMembers()).toBeInTheDocument()
    for (const name of [
      'navigation.settings.rolesAndPermissions',
      'navigation.settings.permissionSet',
    ])
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'navigation.settings.accessToken' }),
    ).toBeInTheDocument()
  },
)

it.each(['feature disabled', 'admin workspace role'])(
  'rejects direct access tokens with %s',
  async (reason) => {
    featureFlags.NEXT_PUBLIC_ENABLE_ACCESS_TOKEN = reason !== 'feature disabled'
    renderSettings(TAB.ACCESS_TOKEN, {
      currentWorkspace: { role: reason === 'admin workspace role' ? 'admin' : 'owner' },
    })
    const dialog = await findSettings()
    expect(await expectMembers()).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'navigation.settings.accessToken' }),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByPlaceholderText(
        'accountSettings.resourceAccessToken.searchPlaceholder',
      ),
    ).not.toBeInTheDocument()
  },
)

it.each([
  {
    reason: 'Community edition',
    options: { systemFeatures: { deployment_edition: 'COMMUNITY' as const } },
  },
  {
    reason: 'a regular member with role-management permission',
    options: { currentWorkspace: { role: 'normal' as const } },
  },
])('hides archives and rejects their direct destination for $reason', async ({ options }) => {
  renderSettings(TAB.WORKFLOW_LOG_ARCHIVES, options)
  const dialog = await findSettings()
  expect(await expectMembers()).toBeInTheDocument()
  expect(
    within(dialog).queryByRole('button', { name: 'appLog.archives.title' }),
  ).not.toBeInTheDocument()
  expect(within(dialog).queryByText('appLog.archives.upgradeTip.title')).not.toBeInTheDocument()
})

it('allows regular members to read billing without management permissions', async () => {
  renderSettings(TAB.BILLING, { currentWorkspace: { role: 'normal' }, workspacePermissionKeys: [] })
  const dialog = await findSettings()
  expect(await within(dialog).findByText('billing.plans.sandbox.name')).toBeInTheDocument()
  expect(
    within(dialog).getByRole('button', { name: 'navigation.settings.billing' }),
  ).toBeInTheDocument()
  expect(
    within(dialog).queryByRole('link', { name: /billing.viewBillingTitle/ }),
  ).not.toBeInTheDocument()
})

it.each([
  {
    reason: 'dataset operators',
    options: { currentWorkspace: { role: 'dataset_operator' as const } },
  },
  {
    reason: 'Community edition',
    options: { systemFeatures: { deployment_edition: 'COMMUNITY' as const } },
  },
])('hides billing and falls back to preferences for $reason', async ({ options }) => {
  renderSettings(TAB.BILLING, options)
  const dialog = await findSettings()
  expect(within(dialog).getByText('accountSettings.account.appearanceLabel')).toBeInTheDocument()
  expect(
    within(dialog).queryByRole('button', { name: 'navigation.settings.billing' }),
  ).not.toBeInTheDocument()
  expect(within(dialog).queryByText('billing.plans.sandbox.name')).not.toBeInTheDocument()
})

it.each([
  { edition: 'CLOUD' as const, canReplaceLogo: false, visible: true },
  { edition: 'COMMUNITY' as const, canReplaceLogo: true, visible: true },
  { edition: 'COMMUNITY' as const, canReplaceLogo: false, visible: false },
])(
  'shows customization by edition and entitlement: $edition, logo=$canReplaceLogo',
  async ({ edition, canReplaceLogo, visible }) => {
    renderSettings(TAB.MEMBERS, {
      workspacePermissionKeys: [],
      features: { can_replace_logo: canReplaceLogo },
      systemFeatures: { deployment_edition: edition },
    })
    const dialog = await findSettings()
    const custom = within(dialog).queryByRole('button', { name: 'custom.custom' })
    if (visible) expect(custom).toBeInTheDocument()
    else expect(custom).not.toBeInTheDocument()
  },
)

it('opens an integration destination and updates the URL through its real sidebar', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate } = renderSettings('custom-tool')
  await act(async () => vi.dynamicImportSettled())
  const dialog = await screen.findByRole('dialog', { name: 'navigation.settings.integrations' })
  await user.click(within(dialog).getByRole('button', { name: 'navigation.common.workflowAsTool' }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('workflow-tool'),
  )
  expect(await within(dialog).findByText('tools.workflowToolEmpty.title')).toBeInTheDocument()
  expect(onUrlUpdate.mock.lastCall?.[0].options).toMatchObject({
    history: 'replace',
    shallow: true,
  })
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('settings')).toBe(false)
})

it('ignores an invalid settings destination', () => {
  renderSettings('unknown')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it.each(['owner', 'admin', 'editor'] as const)(
  'opens IP Policies with the controls allowed for %s',
  async (role) => {
    renderSettings(TAB.IP_POLICIES, { currentWorkspace: { role } })
    const dialog = await findSettings()
    expect(
      await within(dialog).findByRole('heading', { name: 'common.settings.ipPolicyEmptyTitle' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'common.settings.ipPolicies' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('heading', { name: 'common.settings.ipPolicies' }),
    ).toBeInTheDocument()
    if (role === 'editor') {
      expect(
        within(dialog).queryByRole('button', { name: 'common.settings.ipPolicyEmptyCreate' }),
      ).not.toBeInTheDocument()
    } else {
      expect(
        within(dialog).getByRole('button', { name: 'common.settings.ipPolicyEmptyCreate' }),
      ).toBeInTheDocument()
    }
  },
)

it.each(['normal', 'dataset_operator'] as const)(
  'hides IP Policies and rejects its direct destination for %s',
  async (role) => {
    renderSettings(TAB.IP_POLICIES, { currentWorkspace: { role } })
    const dialog = await findSettings()
    expect(await expectMembers()).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'common.settings.ipPolicies' }),
    ).not.toBeInTheDocument()
    expect(within(dialog).queryByText('common.settings.ipPolicyEmptyTitle')).not.toBeInTheDocument()
  },
)
