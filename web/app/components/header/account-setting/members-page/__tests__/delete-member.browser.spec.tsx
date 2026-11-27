import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { MembersPage } from '../index'

const flags = vi.hoisted(() => ({ contactsEnabled: vi.fn(() => false) }))
// boundary: switch the deployment feature flag per scenario.
vi.mock('@/features/contacts/management/feature-flag', () => ({
  isContactsManagementEnabled: flags.contactsEnabled,
}))
// Member routes take UUID path parameters; names stay readable for the accessible queries.
const memberId = (name: string) =>
  `00000000-0000-4000-8000-${String(['Alpha', 'Beta', 'Gamma'].indexOf(name) + 1).padStart(12, '0')}`
const member = (name: string): AccountWithRoleResponse => ({
  id: memberId(name),
  name,
  email: `${name}@example.com`,
  avatar: '',
  avatar_url: '',
  role: 'normal',
  roles: [],
  last_active_at: 1731000000,
  last_login_at: 1731000000,
  created_at: 1731000000,
  status: 'active',
})
beforeEach(() => {
  flags.contactsEnabled.mockReturnValue(false)
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
})
afterEach(() => vi.unstubAllGlobals())

async function setup(ids: string[], { centrallyManaged = false, canManageContacts = false } = {}) {
  let accounts = ids.map(member)
  const { queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    features: { im_centrally_managed: centrallyManaged, members: { size: 0, limit: 0 } },
    systemFeatures: {
      deployment_edition: centrallyManaged ? 'ENTERPRISE' : 'COMMUNITY',
      rbac_enabled: centrallyManaged,
    },
    workspacePermissionKeys: [
      'workspace.member.manage',
      ...(canManageContacts ? ['contact.manage'] : []),
    ],
  })
  const features = queryClient.getQueryData(consoleQuery.features.get.queryKey())!
  const fake = installFakeApi({
    console: {
      features: { get: async () => features },
      workspaces: {
        byWorkspaceId: {
          members: { pendingInvitations: { get: async () => ({ invitations: [] }) } },
        },
        current: {
          members: {
            get: async () => ({ accounts }),
            byMemberId: {
              delete: async ({ params }) => {
                accounts = accounts.filter((item) => item.id !== params.member_id)
                return { result: 'success', tenant_id: 'tenant-1' }
              },
            },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <MembersPage />
    </QueryClientTestProvider>,
  )
  const open = async (id: string) => {
    await screen
      .getByRole('button', { name: `workspaceMembers.members.memberActions: ${id}`, exact: true })
      .click()
    await screen.getByRole('menuitem', { name: /members\.removeFromTeam$/ }).click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  }
  return { screen, open, fake }
}

it.each([false, true])(
  'removes members normally when contact retention is unavailable (centrally managed %s)',
  async (centrallyManaged) => {
    flags.contactsEnabled.mockReturnValue(true)
    const { screen, open, fake } = await setup(['Alpha', 'Beta'], { centrallyManaged })
    await open('Alpha')
    await expect.element(screen.getByRole('checkbox')).not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'contacts.memberRemoval.remove', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Beta', exact: true })).toHaveFocus()
    expect(
      fake.console.workspaces.current.members.byMemberId.delete,
    ).toHaveBeenCalledExactlyOnceWith({
      params: { member_id: memberId('Alpha') },
      query: { keep_as_platform_contact: false },
    })
  },
)

it('keeps a member as a platform contact only after the option is selected', async () => {
  flags.contactsEnabled.mockReturnValue(true)
  const { screen, open, fake } = await setup(['Alpha', 'Beta'], {
    centrallyManaged: true,
    canManageContacts: true,
  })
  const keep = screen.getByRole('checkbox', { name: 'contacts.memberRemoval.keepPlatform' })
  const confirm = screen.getByRole('button', { name: 'contacts.memberRemoval.remove', exact: true })
  const remove = fake.console.workspaces.current.members.byMemberId.delete

  await open('Alpha')
  await expect.element(keep).not.toBeChecked()
  await screen.getByRole('button', { name: 'contacts.memberRemoval.keepPlatform' }).click()
  const hint = screen.getByRole('dialog', { name: 'contacts.memberRemoval.keepPlatform' })
  await expect.element(hint).toHaveTextContent('contacts.memberRemoval.keepPlatformDescription')
  await userEvent.keyboard('{Escape}')
  await expect.element(hint).not.toBeInTheDocument()
  await keep.click()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  expect(remove).not.toHaveBeenCalled()

  await open('Alpha')
  await expect.element(keep).not.toBeChecked()
  await confirm.click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()

  await open('Beta')
  await keep.click()
  await expect.element(keep).toBeChecked()
  await confirm.click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  expect(remove.mock.calls).toEqual([
    [{ params: { member_id: memberId('Alpha') }, query: { keep_as_platform_contact: false } }],
    [{ params: { member_id: memberId('Beta') }, query: { keep_as_platform_contact: true } }],
  ])
})

it('removes the member before a slow list refresh completes', async () => {
  const { screen, open, fake } = await setup(['Alpha', 'Beta'])
  await open('Alpha')
  const refresh = hold(fake.console.workspaces.current.members.get)
  await screen.getByRole('button', { name: /operation\.confirm$/ }).click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Alpha', exact: true }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Beta', exact: true })).toHaveFocus()
  refresh.release()
})

it.each([
  { ids: ['Alpha', 'Beta', 'Gamma'], remove: 'Beta', next: 'Gamma' },
  { ids: ['Alpha', 'Beta'], remove: 'Beta', next: 'Alpha' },
  { ids: ['Alpha'], remove: 'Alpha', next: null },
])('returns focus after removing $remove from $ids', async ({ ids, remove, next }) => {
  const { screen, open } = await setup(ids)
  await open(remove)
  await screen.getByRole('button', { name: /operation\.confirm$/ }).click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: remove, exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(
      next ? screen.getByRole('button', { name: next, exact: true }) : screen.getByRole('region'),
    )
    .toHaveFocus()
})

it('keeps focus and blocks Escape/cancel during removal, then reports a retryable failure', async () => {
  const { screen, open, fake } = await setup(['Alpha'])
  const request = hold(fake.console.workspaces.current.members.byMemberId.delete)
  await open('Alpha')
  const confirm = screen.getByRole('button', { name: /operation\.confirm$/ })
  await confirm.click()
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('button', { name: /operation\.cancel$/ })).toBeDisabled()
  await expect.element(screen.getByRole('alertdialog')).toBeVisible()
  await expect
    .poll(() => fake.console.workspaces.current.members.byMemberId.delete)
    .toHaveBeenCalledTimes(1)
  request.reject(apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Failed' }))
  await expect.element(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
  await confirm.click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('region')).toHaveFocus()
})

it('returns to the menu button when cancelled', async () => {
  const { screen, open, fake } = await setup(['Alpha'])
  await open('Alpha')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect
    .element(
      page.getByRole('button', {
        name: 'workspaceMembers.members.memberActions: Alpha',
        exact: true,
      }),
    )
    .toHaveFocus()
  expect(fake.console.workspaces.current.members.byMemberId.delete).not.toHaveBeenCalled()
})
