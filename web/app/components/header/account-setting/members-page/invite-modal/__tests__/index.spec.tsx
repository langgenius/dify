import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { commonQueryKeys } from '@/service/use-common'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { InviteModal } from '../index'

const { fetchFeatures, inviteMember } = vi.hoisted(() => ({
  fetchFeatures: vi.fn(),
  inviteMember: vi.fn(),
}))

vi.mock('@/service/access-control/use-workspace-roles')
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleQuery: {
      ...actual.consoleQuery,
      systemFeatures: actual.consoleQuery.systemFeatures,
      features: {
        get: {
          queryKey: () => ['features'],
          queryOptions: () => ({ queryKey: ['features'], queryFn: fetchFeatures }),
        },
      },
      workspaces: {
        ...actual.consoleQuery.workspaces,
        current: {
          ...actual.consoleQuery.workspaces.current,
          summary: actual.consoleQuery.workspaces.current.summary,
          members: {
            ...actual.consoleQuery.workspaces.current.members,
            inviteEmail: {
              post: {
                mutationOptions: (
                  options: Parameters<
                    typeof actual.consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions
                  >[0],
                ) => ({ ...options, mutationFn: inviteMember }),
              },
            },
          },
        },
      },
    },
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
    vi.mocked(useWorkspaceRoleList).mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                id: 'admin',
                tenant_id: 'tenant-id',
                type: 'workspace',
                category: 'global_system_default',
                name: 'Admin',
                description: 'Can manage workspace settings',
                is_builtin: true,
                permission_keys: [],
                role_tag: '',
              },
              {
                id: 'editor',
                tenant_id: 'tenant-id',
                type: 'workspace',
                category: 'global_system_default',
                name: 'Editor',
                description: 'Can build and edit apps',
                is_builtin: true,
                permission_keys: [],
                role_tag: '',
              },
            ],
            pagination: {
              total_count: 2,
              per_page: 20,
              current_page: 1,
              total_pages: 1,
            },
          },
        ],
        pageParams: [1],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceRoleList>)
  })

  const renderModal = async ({
    open = true,
    isEmailSetup = true,
    queryClient = createQueryClient(),
    workspaceMembers = { enabled: true, size: 5, limit: 10 },
  }: {
    open?: boolean
    isEmailSetup?: boolean
    queryClient?: QueryClient
    workspaceMembers?: GetFeaturesResponse['workspace_members']
  } = {}) => {
    seedCurrentWorkspaceQuery(queryClient)
    seedSystemFeatures(queryClient, { deployment_edition: 'CLOUD' })
    const features = seedFeatures(queryClient, { workspace_members: workspaceMembers })
    fetchFeatures.mockResolvedValue(features)

    const result = render(
      <QueryClientTestProvider queryClient={queryClient}>
        <InviteModal isEmailSetup={isEmailSetup} onSend={onSend} />
      </QueryClientTestProvider>,
    )
    if (open) await userEvent.click(screen.getByRole('button', { name: /members\.invite$/i }))
    return result
  }

  const selectAdminRole = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('combobox', { name: /members\.role/i }))
    await user.click(screen.getByRole('option', { name: /Admin/i }))
  }

  const addRecipients = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.click(input)
    await user.paste(value)
  }

  it('renders a labeled form inside a business dialog', async () => {
    await renderModal()

    const dialog = screen.getByRole('dialog', { name: /members\.inviteTeamMember$/i })
    expect(within(dialog).getByText(/members\.inviteTeamMemberTip/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('form')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('textbox', { name: /members\.emailRecipients/i }),
    ).toHaveAttribute('inputmode', 'email')
  })

  it('should place initial focus in the email composer', async () => {
    await renderModal()

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /members\.emailRecipients/i })).toHaveFocus()
    })
  })

  it('should focus the email field first when the untouched form is submitted with Enter', async () => {
    const user = userEvent.setup()
    await renderModal()

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await waitFor(() => expect(input).toHaveFocus())
    await user.keyboard('{Enter}')

    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/members\.emailRequired/i)).toBeInTheDocument()
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('does not render dialog content until the invitation trigger is activated', async () => {
    await renderModal({ open: false })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the email service warning in the form', async () => {
    await renderModal({ isEmailSetup: false })

    expect(screen.getByText(/members\.emailNotSetup/i)).toBeInTheDocument()
  })

  it('submits normalized, deduplicated recipients with the selected Role id', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    await renderModal({ queryClient })

    await addRecipients(user, 'First@Example.com, second@example.com; first@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInviteCount/i }))

    await waitFor(() => {
      expect(inviteMember.mock.calls[0]?.[0]).toEqual({
        body: {
          emails: ['first@example.com', 'second@example.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['features'] })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSend).toHaveBeenCalledWith([])
  })

  it('submits a valid draft without requiring Enter or blur to create a chip', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal()

    await selectAdminRole(user)
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'draft@example.com')
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledOnce()
      expect(inviteMember.mock.calls[0]?.[0]).toEqual({
        body: {
          emails: ['draft@example.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
  })

  it('should submit a manually typed email list without requiring Enter', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal()

    await selectAdminRole(user)
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'first@gmail.com,second@gmail.com')
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledOnce()
      expect(inviteMember.mock.calls[0]?.[0]).toEqual({
        body: {
          emails: ['first@gmail.com', 'second@gmail.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
  })

  it('should create exactly one non-empty recipient when a single draft is submitted', async () => {
    const user = userEvent.setup()
    let resolveInvite!: (response: MemberInviteResponse) => void
    inviteMember.mockReturnValue(
      new Promise<MemberInviteResponse>((resolve) => {
        resolveInvite = resolve
      }),
    )
    await renderModal()

    await selectAdminRole(user)
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'only@gmail.com')
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      expect(screen.getByText('only@gmail.com')).toBeInTheDocument()
      expect(input).toHaveValue('')
    })

    await act(async () => {
      resolveInvite({
        result: 'success',
        invitation_results: [],
        tenant_id: 'tenant-id',
      })
    })
  })

  it('should commit a non-empty draft before Enter submits the form', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal()

    await selectAdminRole(user)
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'draft@example.com{Enter}')

    expect(screen.getByText('draft@example.com')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(inviteMember).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledOnce()
      expect(inviteMember.mock.calls[0]?.[0]).toEqual({
        body: {
          emails: ['draft@example.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
  })

  it('accepts an address allowed by the browser without requiring a dotted domain', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal()

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'person@example{Enter}')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => expect(inviteMember).toHaveBeenCalled())
  })

  it('keeps invalid recipients visible and blocks the whole submission', async () => {
    const user = userEvent.setup()
    await renderModal()

    await addRecipients(user, 'valid@example.com, invalid-email')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(screen.getByText('invalid-email')).toBeInTheDocument()
    expect(screen.getAllByText(/members\.emailInvalid/i)).not.toHaveLength(0)
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('should preserve and refocus an invalid draft until the user corrects it', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal()

    await selectAdminRole(user)
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'not-an-email')
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(input).toHaveValue('not-an-email')
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/members\.emailInvalid/i)).toBeInTheDocument()
    expect(inviteMember).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, 'corrected@example.com')
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledOnce()
      expect(inviteMember.mock.calls[0]?.[0]).toEqual({
        body: {
          emails: ['corrected@example.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
  })

  it('shows the required error and focuses the email field after an empty submission', async () => {
    const user = userEvent.setup()
    await renderModal()

    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(screen.getByText(/members\.emailRequired/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /members\.emailRecipients/i })).toHaveFocus()
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('should preserve the email draft while the user resolves a missing role', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal()

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'draft@example.com')
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    const roleTrigger = screen.getByRole('combobox', { name: /members\.role/i })
    expect(roleTrigger).toHaveFocus()
    expect(roleTrigger).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveValue('draft@example.com')
    expect(inviteMember).not.toHaveBeenCalled()

    await user.click(roleTrigger)
    await user.click(screen.getByRole('option', { name: /Admin/i }))
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledOnce()
      expect(inviteMember.mock.calls[0]?.[0]).toEqual({
        body: {
          emails: ['draft@example.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
  })

  it('freezes all editable controls while invitations are being sent', async () => {
    const user = userEvent.setup()
    let resolveInvite!: (response: MemberInviteResponse) => void
    inviteMember.mockReturnValue(
      new Promise<MemberInviteResponse>((resolve) => {
        resolveInvite = resolve
      }),
    )
    await renderModal()

    await addRecipients(user, 'user@example.com, another@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /members\.emailRecipients/i })).toBeDisabled()
      expect(screen.getByRole('combobox', { name: /members\.role/i })).toBeDisabled()
      expect(
        screen.getByRole('button', { name: /operation\.remove.*user@example\.com/i }),
      ).toBeDisabled()
      expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    })
    expect(inviteMember).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /operation\.close/ })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/ }))
    expect(inviteMember).toHaveBeenCalledOnce()

    await act(async () => {
      resolveInvite({
        result: 'success',
        invitation_results: [],
        tenant_id: 'tenant-id',
      })
    })
  })

  it('keeps the request session open until both cache refreshes complete', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const refreshes: Array<() => void> = []
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(() => new Promise<void>((resolve) => refreshes.push(resolve)))
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    })
    await renderModal({ queryClient })
    await addRecipients(user, 'person@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/ }))
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(2))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['features'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: commonQueryKeys.members })
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onSend).not.toHaveBeenCalled()
    await act(async () => refreshes[0]!())
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /operation\.close/ })).toBeDisabled()
    await act(async () => refreshes[1]!())
    await waitFor(() => expect(onSend).toHaveBeenCalledExactlyOnceWith([]))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(invalidateQueries).toHaveBeenCalledTimes(2)
  })

  it('warns but lets the backend decide whether recipients consume remaining seats', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    await renderModal({ workspaceMembers: { enabled: true, size: 9, limit: 10 } })

    await addRecipients(user, 'one@example.com, two@example.com')
    await selectAdminRole(user)

    expect(screen.getByText(/members\.recipientCountExceedsSeats/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))
    await waitFor(() => expect(inviteMember).toHaveBeenCalled())
  })

  it('counts a manually typed recipient list before it is committed', async () => {
    const user = userEvent.setup()
    await renderModal({ workspaceMembers: { enabled: true, size: 9, limit: 10 } })

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'one@example.com,two@example.com')

    expect(
      screen.getByRole('button', { name: /members\.sendInviteCount.*"count":2/i }),
    ).toBeEnabled()
    expect(screen.getByText(/members\.recipientCountExceedsSeats/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: /members\.emailRecipients/i }),
    ).not.toBeInTheDocument()
    expect(input).toHaveValue('one@example.com,two@example.com')
  })

  it.each([
    ['limit_exceeded', /members\.inviteLimitExceeded/i, 'emails', 'textbox'],
    ['invalid_role', /members\.invalidRole/i, 'role', 'combobox'],
  ])('maps %s server validation to the owning field', async (code, message, fieldName, role) => {
    const user = userEvent.setup()
    inviteMember.mockRejectedValue({
      code: 'BAD_REQUEST',
      data: { body: { code, message: 'Backend message' } },
    })
    await renderModal()

    await addRecipients(user, 'user@example.com, another@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(document.querySelector(`[name="${fieldName}"]`)).toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.getByRole(role, {
        name: fieldName === 'emails' ? /members\.emailRecipients/i : /members\.role/i,
      }),
    ).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps a role server error visible when the user only opens the selector', async () => {
    const user = userEvent.setup()
    inviteMember.mockRejectedValue({
      code: 'BAD_REQUEST',
      data: { body: { code: 'invalid_role', message: 'Backend message' } },
    })
    await renderModal()

    await addRecipients(user, 'user@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(await screen.findByText(/members\.invalidRole/i)).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: /members\.role/i }))

    expect(screen.getByText(/members\.invalidRole/i)).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /Editor/i }))

    expect(screen.queryByText(/members\.invalidRole/i)).not.toBeInTheDocument()
  })

  it('should clear an email server error when the user edits and successfully retries', async () => {
    const user = userEvent.setup()
    inviteMember
      .mockRejectedValueOnce({
        code: 'BAD_REQUEST',
        data: { body: { code: 'limit_exceeded', message: 'Backend message' } },
      })
      .mockResolvedValueOnce({
        result: 'success',
        invitation_results: [],
        tenant_id: 'tenant-id',
      } satisfies MemberInviteResponse)
    await renderModal()

    await addRecipients(user, 'first@example.com, second@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(await screen.findByText(/members\.inviteLimitExceeded/i)).toBeInTheDocument()

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'third@example.com')
    expect(screen.queryByText(/members\.inviteLimitExceeded/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledTimes(2)
      expect(inviteMember.mock.calls[1]?.[0]).toEqual({
        body: {
          emails: ['first@example.com', 'second@example.com', 'third@example.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
  })

  it('should clear an email server error when a recipient is removed before retrying', async () => {
    const user = userEvent.setup()
    inviteMember
      .mockRejectedValueOnce({
        code: 'BAD_REQUEST',
        data: { body: { code: 'limit_exceeded', message: 'Backend message' } },
      })
      .mockResolvedValueOnce({
        result: 'success',
        invitation_results: [],
        tenant_id: 'tenant-id',
      } satisfies MemberInviteResponse)
    await renderModal()

    await addRecipients(user, 'first@example.com, second@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(await screen.findByText(/members\.inviteLimitExceeded/i)).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /operation\.remove.*second@example\.com/i }),
    )
    expect(screen.queryByText(/members\.inviteLimitExceeded/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledTimes(2)
      expect(inviteMember.mock.calls[1]?.[0]).toEqual({
        body: {
          emails: ['first@example.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
  })

  it('keeps request failures visible until the user closes, then starts a fresh draft', async () => {
    const user = userEvent.setup()
    inviteMember.mockRejectedValue(new Error('Network failed'))
    await renderModal()

    await addRecipients(user, 'user@example.com, another@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/members\.inviteFailed/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /operation\.close/ }))
    const trigger = screen.getByRole('button', { name: /members\.invite$/ })
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.click(trigger)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('user@example.com')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /members\.emailRecipients/ })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: /members\.role/ }).textContent).toMatch(
      /members\.selectRole/,
    )
  })

  it('closes through its own close button', async () => {
    const user = userEvent.setup()
    await renderModal()

    await user.click(screen.getByRole('button', { name: /operation\.close/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('resets the popup draft after closing and reopening', async () => {
    const user = userEvent.setup()
    await renderModal({ open: false })

    const trigger = screen.getByRole('button', { name: /members\.invite$/i })
    await user.click(trigger)
    await addRecipients(user, 'person@example.com, another@example.com')
    await user.click(screen.getByRole('button', { name: /operation\.close/i }))

    await waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    expect(screen.queryByText('person@example.com')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /members\.role/i }).textContent).toMatch(
      /members\.selectRole/i,
    )
  })
})
