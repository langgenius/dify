import type { Resource } from 'i18next'
import type { AccountSettingTab } from '../constants'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { Suspense, useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import {
  createNetworkAccessGroupFixture,
  seedNetworkAccessGroups,
} from '@/test/console/network-access'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ACCOUNT_SETTING_TAB } from '../constants'
import AccountSetting from '../index'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ loadResource: vi.fn() }))
// boundary: defer the external translation load while keeping i18next and its consumers real.
vi.mock('@/i18n/load-resource', () => ({ loadI18nResource: mocks.loadResource }))

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
const resources: Resource = {
  'en-US': {
    appLog: {},
    billing: {},
    custom: {},
    accountSettings: {},
    contacts: {},
    common: {
      loading: 'Loading',
      'operation.close': 'Close',
      'settings.ipPolicies': 'IP Policies',
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
  seedNetworkAccessGroups(queryClient, {
    entitled: true,
    groups: [createNetworkAccessGroupFixture()],
  })
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    queryClient,
    currentWorkspace: { id: 'workspace-1', name: 'Workspace', role: 'owner' },
    workspacePermissionKeys: ['workspace.member.manage'],
    systemFeatures: { deployment_edition: 'CLOUD', is_email_setup: true },
    features: { billing: { subscription: { plan: 'team' } } },
  })
  return render(
    <Wrapper>
      <I18nClientProvider locale="en-US" resource={structuredClone(resources)}>
        <NuqsTestingAdapter>
          <Suspense fallback={<span>Loading settings</span>}>
            <Settings />
          </Suspense>
        </NuqsTestingAdapter>
      </I18nClientProvider>
    </Wrapper>,
  )
}

function deferNamespace(namespace: string) {
  let finishLoading!: () => void
  let requested!: () => void
  const started = new Promise<void>((resolve) => {
    requested = resolve
  })
  const pending = new Promise<void>((resolve) => {
    finishLoading = resolve
  })
  mocks.loadResource.mockImplementation(async (_locale: string, name: string) => {
    if (name === namespace) {
      requested()
      await pending
    }
    return { default: {} }
  })
  return { started, finishLoading }
}

describe('Settings content loading', () => {
  beforeEach(() => {
    mocks.loadResource.mockReset()
  })

  it('keeps navigation operable while a tab loads its translations', async () => {
    const { started, finishLoading } = deferNamespace('deployments')
    await renderSettings()
    await page.getByRole('button', { name: 'IP Policies' }).click()
    await started
    await expect.element(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await expect.element(page.getByText('Loading settings')).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Members', exact: true }).click()
    await expect.element(page.getByRole('button', { name: 'Ada', exact: true })).toBeVisible()
    finishLoading()
    await page.getByRole('button', { name: 'IP Policies' }).click()
    await expect.element(page.getByRole('cell', { name: 'Internal Network' })).toBeVisible()
  })

  it('exposes working member actions after shared form translations load', async () => {
    const { started, finishLoading } = deferNamespace('permission')
    await renderSettings()
    await started
    await expect.element(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Invite members' }))
      .not.toBeInTheDocument()
    finishLoading()
    await page.getByRole('button', { name: 'Member actions: Ada' }).click()
    await page.getByRole('menuitem', { name: 'Edit Role' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Edit Role' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog', { name: 'Edit Role' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('table')).toBeVisible()
    await page.getByRole('button', { name: 'Invite members' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Invite team member' })).toBeVisible()
    await expect.element(page.getByText('Loading settings')).not.toBeInTheDocument()
  })

  it('keeps member details usable while the role permission translations load', async () => {
    const { started, finishLoading } = deferNamespace('permissionKeys')
    await renderSettings()
    await page.getByRole('button', { name: 'Ada', exact: true }).click()
    const details = page.getByRole('dialog', { name: 'Member details' })
    await details.getByRole('button', { name: 'Admin', exact: true }).click()
    await started
    await expect.element(details).toBeVisible()
    await expect.element(page.getByText('Loading settings')).not.toBeInTheDocument()
    finishLoading()
    await expect.element(page.getByText('app.create', { exact: true })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByText('app.create', { exact: true })).not.toBeInTheDocument()
    await expect.element(details).toBeVisible()
    await details.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.element(details).not.toBeInTheDocument()
    await expect.element(page.getByRole('table')).toBeVisible()
  })
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
