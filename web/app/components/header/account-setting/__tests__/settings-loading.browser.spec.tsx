import type { NetworkAccessGroupListResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Resource } from 'i18next'
import type { AccountSettingTab } from '../constants'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { Suspense, useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import commonTranslations from '@/i18n/locales/en-US/common.json'
import { TEST_WORKSPACE_ID } from '@/test/console/ids'
import { createNetworkAccessGroupFixture } from '@/test/console/network-access'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { setupFakeApi } from '@/test/fake-api'
import { ACCOUNT_SETTING_TAB } from '../constants'
import AccountSetting from '../index'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ loadResource: vi.fn() }))
// boundary: defer the external translation load while keeping i18next and its consumers real.
vi.mock('@/i18n/load-resource', () => ({ loadI18nResource: mocks.loadResource }))

const resources: Resource = {
  'en-US': {
    appLog: {},
    billing: {},
    custom: {},
    accountSettings: {},
    contacts: {},
    common: commonTranslations,
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

function Settings({ initialTab }: { initialTab: AccountSettingTab }) {
  const [activeTab, setActiveTab] = useState(initialTab)
  return (
    <AccountSetting
      activeTab={activeTab}
      onTabChangeAction={setActiveTab}
      onCancelAction={() => {}}
    />
  )
}

function renderSettings(
  initialTab: AccountSettingTab = ACCOUNT_SETTING_TAB.MEMBERS,
  systemFeatures: ConsoleQueryTestOptions['systemFeatures'] = {},
) {
  const queryClient = createConsoleQueryClient()
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    queryClient,
    currentWorkspace: { id: TEST_WORKSPACE_ID, name: 'Workspace', role: 'owner' },
    workspacePermissionKeys: ['workspace.member.manage'],
    systemFeatures: { deployment_edition: 'CLOUD', is_email_setup: true, ...systemFeatures },
    features: { billing: { subscription: { plan: 'team' } } },
  })
  return render(
    <Wrapper>
      <I18nClientProvider locale="en-US" resource={structuredClone(resources)}>
        <NuqsTestingAdapter>
          <Suspense fallback={<span>Loading settings</span>}>
            <Settings initialTab={initialTab} />
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

const fake = setupFakeApi(() => ({
  console: {
    workspaces: {
      byWorkspaceId: {
        members: { pendingInvitations: { get: () => ({ invitations: [] }) } },
      },
      current: {
        networkAccessGroups: {
          get: () => ({ tenant_id: TEST_WORKSPACE_ID, entitled: true, groups: [] }),
          post: () => ({ group: createNetworkAccessGroupFixture() }),
          currentIp: { get: () => ({ client_ip: '203.0.113.42' }) },
        },
        members: {
          get: () => ({
            accounts: [
              {
                id: '6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f',
                name: 'Ada',
                email: 'ada@example.com',
                avatar_url: null,
                role: 'admin',
                status: 'active',
                created_at: 1731000000,
                last_active_at: 1731000000,
                roles: [{ id: 'admin', name: 'Admin' }],
              },
            ],
          }),
        },
        rbac: {
          members: {
            byMemberId: {
              rbacRoles: {
                get: ({ params }) => ({
                  account_id: params.member_id,
                  roles: [
                    {
                      id: 'admin',
                      name: 'Admin',
                      type: 'workspace',
                      is_builtin: true,
                      permission_keys: ['app.create', 'ip_policy.view', 'ip_policy.manage'],
                    },
                  ],
                }),
              },
            },
          },
          roles: {
            get: () => ({
              data: [],
              pagination: { current_page: 1, total_pages: 1, total_count: 0, per_page: 20 },
            }),
          },
        },
      },
    },
  },
}))

describe('Settings content loading', () => {
  beforeEach(() => {
    mocks.loadResource.mockReset()
  })

  it('keeps the IP Policies deep link stable through loading, dismissal and first creation', async () => {
    vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
    const { finishLoading } = deferNamespace('deployments')
    const groups = createDeferred<NetworkAccessGroupListResponse>()
    fake.console.workspaces.current.networkAccessGroups.get.mockReturnValue(groups.promise)
    try {
      await renderSettings(ACCOUNT_SETTING_TAB.IP_POLICIES)
      const settings = page.getByRole('dialog', { name: 'Settings' })
      await expect.element(settings.getByRole('heading', { name: 'IP Policies' })).toBeVisible()
      await expect
        .poll(() => fake.console.workspaces.current.networkAccessGroups.get.mock.calls.length)
        .toBe(1)
      await expect.element(settings.getByRole('progressbar', { name: 'Loading' })).toBeVisible()
      await expect
        .element(settings.getByRole('button', { name: 'Add', exact: true }))
        .not.toBeInTheDocument()
      const create = settings.getByRole('button', { name: 'Create an IP policy' })
      await expect.element(create).not.toBeInTheDocument()

      groups.resolve({ tenant_id: TEST_WORKSPACE_ID, entitled: true, groups: [] })
      await expect.element(create).toBeVisible()
      await expect
        .element(settings.getByRole('progressbar', { name: 'Loading' }))
        .not.toBeInTheDocument()
      await expect
        .element(settings.getByRole('button', { name: 'Add', exact: true }))
        .not.toBeInTheDocument()

      await create.click()
      const editor = page.getByRole('dialog', { name: 'New IP Policy' })
      const name = editor.getByRole('textbox', { name: 'Name', exact: true })
      await editor.getByPlaceholder('10.0.0.0/8').fill('10.0.0.0/8')
      await name.fill('Unsaved office network')
      await expect
        .element(editor.getByRole('button', { name: 'Create', exact: true }))
        .toBeEnabled()
      await userEvent.keyboard('{Escape}')
      await expect.element(editor).not.toBeInTheDocument()
      await expect.element(create).toHaveFocus()
      expect(fake.console.workspaces.current.networkAccessGroups.post).not.toHaveBeenCalled()
      await userEvent.keyboard('{Enter}')
      await expect.element(name).toHaveValue('')

      const group = createNetworkAccessGroupFixture({ name: 'Office network' })
      fake.console.workspaces.current.networkAccessGroups.post.mockResolvedValue({ group })
      fake.console.workspaces.current.networkAccessGroups.get.mockResolvedValue({
        tenant_id: TEST_WORKSPACE_ID,
        entitled: true,
        groups: [group],
      })
      await name.fill(group.name)
      await editor.getByPlaceholder('10.0.0.0/8').fill('10.0.0.0/8')
      await editor.getByRole('button', { name: 'Create', exact: true }).click()
      await expect.element(editor).not.toBeInTheDocument()
      // The first save can restore focus to the heading before the new Add trigger commits
      // (#46816). Verify focus returns to Settings, then exercise the settled list's trigger.
      await expect.poll(() => settings.element().contains(document.activeElement)).toBe(true)
      await expect
        .element(settings.getByRole('button', { name: group.name, exact: true }))
        .toBeVisible()
      const add = settings.getByRole('button', { name: 'Add', exact: true })
      await add.click()
      await expect.element(name).toHaveValue('')
      await userEvent.keyboard('{Escape}')
      await expect.element(editor).not.toBeInTheDocument()
      await expect.element(add).toHaveFocus()
      expect(fake.console.workspaces.current.networkAccessGroups.post).toHaveBeenCalledTimes(1)
      expect(mocks.loadResource).not.toHaveBeenCalledWith('en-US', 'deployments')
    } finally {
      finishLoading()
    }
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
    await renderSettings(ACCOUNT_SETTING_TAB.MEMBERS, {
      deployment_edition: 'ENTERPRISE',
      rbac_enabled: true,
    })
    await page.getByRole('button', { name: 'Ada', exact: true }).click()
    const details = page.getByRole('dialog', { name: 'Member details' })
    await details.getByRole('button', { name: 'Admin', exact: true }).click()
    await started
    await expect.element(details).toBeVisible()
    await expect.element(page.getByText('Loading settings')).not.toBeInTheDocument()
    finishLoading()
    await expect.element(page.getByText('app.create', { exact: true })).toBeVisible()
    await expect.element(page.getByText(/ip_policy\./)).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByText('app.create', { exact: true })).not.toBeInTheDocument()
    await expect.element(details).toBeVisible()
    await details.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.element(details).not.toBeInTheDocument()
    await expect.element(page.getByRole('table')).toBeVisible()
  })
})
