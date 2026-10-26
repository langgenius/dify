import type { Resource } from 'i18next'
import type { AccountSettingTab } from '../constants'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { Suspense, useState } from 'react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { seedNetworkAccessGroups } from '@/test/console/network-access'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { ACCOUNT_SETTING_TAB } from '../constants'
import AccountSetting from '../index'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ loadResource: vi.fn() }))
vi.mock('@/i18n/load-resource', () => ({ loadI18nResource: mocks.loadResource }))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1', name: 'Workspace', role: 'owner' },
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceOwner: true,
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['workspace.member.manage'],
  }))
})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': async () => ({
        accounts: [
          {
            id: 'member-1',
            name: 'Ada',
            email: 'ada@example.com',
            role: 'admin',
            status: 'active',
            created_at: 1731000000,
            last_active_at: 1731000000,
            roles: [{ id: 'admin', name: 'Admin' }],
          },
        ],
      }),
      'workspaces.current.rbac.members.byMemberId.rbacRoles.get': async () => ({
        roles: [{ id: 'admin', name: 'Admin', is_builtin: true, permission_keys: ['app.create'] }],
      }),
      'workspaces.current.rbac.roles.get': async () => ({
        data: [],
        pagination: { current_page: 1, total_pages: 1, total_count: 0, per_page: 20 },
      }),
    }),
  }
})
vi.mock('@/hooks/use-breakpoints', () => ({
  MediaType: { mobile: 'mobile', tablet: 'tablet', pc: 'pc' },
  default: () => 'pc',
}))
vi.mock('@/app/components/billing/billing-page', () => ({ default: () => null }))
vi.mock('@/app/components/custom/custom-page', () => ({ default: () => null }))
vi.mock('../access-rules-page', () => ({ default: () => null }))
vi.mock('../permissions-page', () => ({ default: () => null }))
vi.mock('../preference-page', () => ({ default: () => null }))
vi.mock('../workflow-log-archives-page', () => ({ default: () => null }))

const resources: Resource = {
  'en-US': {
    appLog: {},
    billing: {},
    custom: {},
    accountSettings: {},
    common: {
      loading: 'Loading',
      'operation.close': 'Close',
      'settings.ipPolicies': 'IP Policies',
      'settings.ipPolicyEmptyTitle': 'No IP policies yet',
    },
    navigation: {
      'settings.settings': 'Settings',
      'settings.members': 'Members',
    },
    workspaceMembers: {
      'members.memberDetails.rolePermissionSummary':
        '{{role}}: <permissionList>{{permissions}}</permissionList>',
      'members.memberDetails.title': 'Member details',
      'members.memberActions': 'Member actions',
      'members.editRole': 'Edit Role',
      'members.invite': 'Invite members',
      'members.inviteTeamMember': 'Invite team member',
    },
  },
}

function Settings() {
  const [activeTab, setActiveTab] = useState<AccountSettingTab>(ACCOUNT_SETTING_TAB.MEMBERS)
  return (
    <AccountSetting
      activeTab={activeTab}
      onTabChangeAction={setActiveTab}
      onCancelAction={() => {}}
    />
  )
}

function renderSettings() {
  const queryClient = createConsoleQueryClient()
  seedNetworkAccessGroups(queryClient, { entitled: true, groups: [] })
  return renderWithConsoleQuery(
    <I18nClientProvider locale="en-US" resource={structuredClone(resources)}>
      <NuqsTestingAdapter>
        <Suspense fallback={<span>Loading settings</span>}>
          <Settings />
        </Suspense>
      </NuqsTestingAdapter>
    </I18nClientProvider>,
    {
      queryClient,
      systemFeatures: { deployment_edition: 'CLOUD', is_email_setup: true },
      features: { billing: { subscription: { plan: 'team' } } },
    },
  )
}

function deferNamespace(namespace: string) {
  let finishLoading!: () => void
  const pending = new Promise<void>((resolve) => {
    finishLoading = resolve
  })
  mocks.loadResource.mockImplementation(async (_locale: string, requested: string) => {
    if (requested === namespace) await pending
    return { default: {} }
  })
  return async () => {
    await act(async () => {
      finishLoading()
      await pending
    })
  }
}

describe('Settings content loading', () => {
  beforeEach(() => {
    mocks.loadResource.mockReset()
  })

  it('keeps the dialog and navigation visible while a tab loads its translations', async () => {
    const user = userEvent.setup()
    const finishLoading = deferNamespace('deployments')
    renderSettings()
    await user.click(await screen.findByRole('button', { name: 'IP Policies' }))

    await waitFor(() => {
      expect(mocks.loadResource).toHaveBeenCalledWith('en-US', 'deployments')
    })
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Members' })).toBeVisible()
    expect(screen.queryByText('Loading settings')).not.toBeInTheDocument()

    await finishLoading()
    expect(await screen.findByRole('heading', { name: 'No IP policies yet' })).toBeVisible()
  })

  it('loads shared form translations before exposing member actions', async () => {
    const user = userEvent.setup()
    const finishLoading = deferNamespace('permission')
    renderSettings()
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('en-US', 'permission'))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Invite members' })).not.toBeInTheDocument()
    await finishLoading()
    await user.click(await screen.findByRole('button', { name: 'Member actions: Ada' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit Role' }))
    expect(await screen.findByRole('dialog', { name: 'Edit Role' })).toBeVisible()
    expect(screen.getByRole('table', { hidden: true })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Invite members' }))
    expect(await screen.findByRole('dialog', { name: 'Invite team member' })).toBeVisible()
    expect(screen.queryByText('Loading settings')).not.toBeInTheDocument()
  })

  it('keeps member details mounted while the permission summary loads its translations', async () => {
    const user = userEvent.setup()
    const finishLoading = deferNamespace('permissionKeys')
    renderSettings()
    await user.click(await screen.findByRole('button', { name: 'Ada' }))
    const details = await screen.findByRole('dialog', { name: 'Member details' })
    const role = await within(details).findByRole('button', { name: 'Admin' })
    expect(mocks.loadResource).not.toHaveBeenCalledWith('en-US', 'permissionKeys')
    await user.click(role)
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('en-US', 'permissionKeys'))
    expect(details).toBeVisible()
    expect(within(details).getByRole('button', { name: 'Close', hidden: true })).toBeInTheDocument()
    expect(screen.queryByText('Loading settings')).not.toBeInTheDocument()
    await finishLoading()
    expect(await screen.findByText('app.create')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(details).toBeVisible()
  })
})
