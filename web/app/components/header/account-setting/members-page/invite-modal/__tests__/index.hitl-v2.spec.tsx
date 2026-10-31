import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { ContactsManagementMockProvider } from '@/features/contacts/management/__tests__/fixtures/composition'
import {
  ContactsMockScenario,
  createContactsMockScenario,
} from '@/features/contacts/management/__tests__/fixtures/scenarios'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { InviteModal } from '../index'

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: true,
}))

const { fetchFeatures, inviteMember, fetchRoles } = vi.hoisted(() => ({
  fetchFeatures: vi.fn(),
  inviteMember: vi.fn(),
  fetchRoles: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { workspaces } = await import('@dify/contracts/api/console/workspaces/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const validate = validateDefinedErrors({ workspaces })
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': fetchFeatures,
      'workspaces.current.rbac.roles.get': fetchRoles,
      'workspaces.current.members.inviteEmail.post': (input: unknown) =>
        validate({
          context: {},
          input,
          path: ['workspaces', 'current', 'members', 'inviteEmail', 'post'],
          next: () => inviteMember(input),
        }),
    }),
  }
})

describe('InviteModal', () => {
  const onSend = vi.fn()

  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })

  beforeEach(() => {
    vi.clearAllMocks()
    fetchRoles.mockResolvedValue({
      data: ['Admin', 'Editor'].map((name) => ({
        id: name.toLowerCase(),
        tenant_id: 'tenant-id',
        type: 'workspace',
        category: 'global_system_default',
        name,
        description: `${name} role`,
        is_builtin: true,
        permission_keys: [],
        role_tag: '',
      })),
      pagination: { total_count: 2, per_page: 20, current_page: 1, total_pages: 1 },
    })
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    })
  })

  const renderModal = async ({
    open = true,
    isEmailSetup = true,
    queryClient = createQueryClient(),
    contactsScenario,
    workspaceMembers = { enabled: true, size: 5, limit: 10 },
  }: {
    open?: boolean
    isEmailSetup?: boolean
    queryClient?: QueryClient
    contactsScenario?: ContactsMockScenario
    workspaceMembers?: GetFeaturesResponse['workspace_members']
  } = {}) => {
    seedCurrentWorkspaceQuery(queryClient)
    seedSystemFeatures(queryClient, { deployment_edition: 'CLOUD' })
    const features = seedFeatures(queryClient, { workspace_members: workspaceMembers })
    fetchFeatures.mockResolvedValue(features)

    const result = render(
      <QueryClientTestProvider queryClient={queryClient}>
        {contactsScenario ? (
          <ContactsManagementMockProvider scenario={createContactsMockScenario(contactsScenario)}>
            <InviteModal isEmailSetup={isEmailSetup} onSend={onSend} />
          </ContactsManagementMockProvider>
        ) : (
          <InviteModal isEmailSetup={isEmailSetup} onSend={onSend} />
        )}
      </QueryClientTestProvider>,
    )
    if (open) {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /members\.invite$/i }))
    }
    return result
  }

  const selectAdminRole = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('combobox', { name: /members\.role/i }))
    await user.click(await screen.findByRole('option', { name: /Admin/i }))
  }

  const addRecipients = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.click(input)
    await user.paste(value)
  }

  it('asks for confirmation before inviting an email used by an External Contact', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal({ contactsScenario: ContactsMockScenario.EeMixed })

    await addRecipients(user, 'external@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    const confirmation = await screen.findByRole('alertdialog', {
      name: /contacts\.memberInviteUpgrade\.title/i,
    })
    expect(inviteMember).not.toHaveBeenCalled()

    await user.click(
      within(confirmation).getByRole('button', { name: /contacts\.action\.cancel/i }),
    )

    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', {
          name: /contacts\.memberInviteUpgrade\.title/i,
        }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText('external@example.com')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /members\.role/i })).toHaveTextContent('Admin')
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('submits the pending invitation only after Add and upgrade is confirmed', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal({ contactsScenario: ContactsMockScenario.EeMixed })

    await addRecipients(user, 'external@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    const confirmation = await screen.findByRole('alertdialog', {
      name: /contacts\.memberInviteUpgrade\.title/i,
    })
    await user.click(
      within(confirmation).getByRole('button', {
        name: /contacts\.memberInviteUpgrade\.confirm/i,
      }),
    )

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledOnce()
      expect(inviteMember.mock.calls[0]?.[0]).toEqual({
        body: {
          emails: ['external@example.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
  })

  it('submits directly when no invited email belongs to an External Contact', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal({ contactsScenario: ContactsMockScenario.EeMixed })

    await addRecipients(user, 'new-member@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => expect(inviteMember).toHaveBeenCalledOnce())
    expect(
      screen.queryByRole('alertdialog', { name: /contacts\.memberInviteUpgrade\.title/i }),
    ).not.toBeInTheDocument()
  })
})
