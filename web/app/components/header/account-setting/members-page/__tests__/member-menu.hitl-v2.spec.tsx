import type { AccountWithRoleResponse as Member } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { ContactsManagementMockProvider } from '@/features/contacts/management/composition'
import {
  ContactsMockScenario,
  createContactsMockScenario,
} from '@/features/contacts/management/mock/scenarios'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MemberMenu from '../member-menu'

const deleteMemberOrCancelInvitation = vi.hoisted(() => vi.fn())

const mockIsContactsManagementEnabled = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
  },
}))
vi.mock('@/features/contacts/management/feature-flag', () => ({
  isContactsManagementEnabled: () => mockIsContactsManagementEnabled(),
}))

const createRole = (overrides: Partial<Role>): Role => ({
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Role',
  description: '',
  is_builtin: false,
  permission_keys: [],
  role_tag: '',
  ...overrides,
})

const roles = [
  createRole({ id: 'role-1', name: 'First role' }),
  createRole({ id: 'role-2', name: 'Second role' }),
]

const member: Member = {
  id: 'member-1',
  name: 'Member User',
  email: 'member@example.com',
  avatar: '',
  avatar_url: '',
  role: 'normal',
  roles: [roles[0]!],
  last_active_at: 1731000000,
  last_login_at: 1731000000,
  created_at: 1731000000,
  status: 'active',
}

describe('MemberMenu', () => {
  const mockUpdateRolesOfMember = vi.fn()

  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
        },
        mutations: {
          retry: false,
        },
      },
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsContactsManagementEnabled.mockReturnValue(true)
    mockUpdateRolesOfMember.mockResolvedValue(undefined)
    vi.mocked(deleteMemberOrCancelInvitation).mockResolvedValue({
      result: 'success',
      tenant_id: 'tenant-1',
    })
  })

  it.each([
    ['workspace owner', { ...member, role: 'owner' as const }, false],
    ['current member', member, true],
  ])('keeps the existing protection for the %s', (_case, protectedMember, isCurrentUser) => {
    renderWithConsoleQuery(<MemberMenu member={protectedMember} isCurrentUser={isCurrentUser} />)

    expect(
      screen.queryByRole('button', { name: /members\.memberActions/i }),
    ).not.toBeInTheDocument()
  })

  it('uses the mock Contacts-aware flow for an active member without calling the real service', async () => {
    const user = userEvent.setup()
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    const queryClient = createQueryClient()
    const membersQueryKey = [...consoleQuery.workspaces.current.members.get.key(), 'en-US']
    const activeMember = { ...member, id: 'member-owner' }
    queryClient.setQueryData(membersQueryKey, { accounts: [activeMember] })

    renderWithConsoleQuery(
      <ContactsManagementMockProvider scenario={scenario}>
        <MemberMenu member={activeMember} isCurrentUser={false} />
      </ContactsManagementMockProvider>,
      { queryClient },
    )

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))
    await user.click(screen.getByRole('menuitem', { name: /members\.removeFromTeam/i }))

    const dialog = screen.getByRole('alertdialog', {
      name: /contacts\.memberRemoval\.title/,
    })
    expect(within(dialog).getByRole('checkbox', { name: /keepPlatform/ })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'contacts.memberRemoval.remove' }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(deleteMemberOrCancelInvitation).not.toHaveBeenCalled()
    expect(queryClient.getQueryData<{ accounts: Member[] }>(membersQueryKey)?.accounts).toEqual([])
    expect(toast.success).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully')
  })

  it('closes the member confirmation without changing membership when cancelled', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(<MemberMenu member={member} isCurrentUser={false} />)

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))
    await user.click(screen.getByRole('menuitem', { name: /members\.removeFromTeam/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(deleteMemberOrCancelInvitation).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the member confirmation open after a failed removal and allows retry', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteMemberOrCancelInvitation).mockRejectedValueOnce(new Error('Request failed'))
    renderWithConsoleQuery(<MemberMenu member={member} isCurrentUser={false} />)

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))
    await user.click(screen.getByRole('menuitem', { name: /members\.removeFromTeam/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'contacts.memberRemoval.remove' }))

    await waitFor(() => {
      expect(
        within(dialog).getByRole('button', { name: 'contacts.memberRemoval.remove' }),
      ).toBeEnabled()
    })
    expect(dialog).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'contacts.memberRemoval.remove' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(deleteMemberOrCancelInvitation).toHaveBeenCalledTimes(2)
  })

  it('keeps the existing invitation cancellation path when Contacts mock is enabled', async () => {
    const user = userEvent.setup()
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)

    renderWithConsoleQuery(
      <ContactsManagementMockProvider scenario={scenario}>
        <MemberMenu member={{ ...member, status: 'pending' }} isCurrentUser={false} />
      </ContactsManagementMockProvider>,
    )

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))
    await user.click(screen.getByRole('menuitem', { name: /members\.removeFromTeam/i }))
    const dialog = screen.getByRole('alertdialog', {
      name: /workspaceMembers\.members\.removeFromTeamConfirmTitle/,
    })
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /common\.operation\.confirm/i }))

    await waitFor(() => expect(deleteMemberOrCancelInvitation).toHaveBeenCalledOnce())
  })

  it('keeps the production removal path when the Contacts feature gate is disabled', async () => {
    const user = userEvent.setup()
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    mockIsContactsManagementEnabled.mockReturnValue(false)

    renderWithConsoleQuery(
      <ContactsManagementMockProvider scenario={scenario}>
        <MemberMenu member={member} isCurrentUser={false} />
      </ContactsManagementMockProvider>,
    )

    await user.click(screen.getByRole('button', { name: /members\.memberActions/i }))
    await user.click(screen.getByRole('menuitem', { name: /members\.removeFromTeam/i }))
    const dialog = screen.getByRole('alertdialog', {
      name: /workspaceMembers\.members\.removeFromTeamConfirmTitle/,
    })
    await user.click(within(dialog).getByRole('button', { name: /common\.operation\.confirm/i }))

    await waitFor(() => expect(deleteMemberOrCancelInvitation).toHaveBeenCalledOnce())
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleClient: {
      workspaces: {
        current: { members: { byMemberId: { delete: deleteMemberOrCancelInvitation } } },
      },
    },
  }
})
