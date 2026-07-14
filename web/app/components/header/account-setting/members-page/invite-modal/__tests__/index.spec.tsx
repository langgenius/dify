import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { vi } from 'vitest'
import { useProviderContextSelector } from '@/context/provider-context'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { InviteModal } from '../index'

const { inviteMember } = vi.hoisted(() => ({ inviteMember: vi.fn() }))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: vi.fn(),
}))
vi.mock('@/service/access-control/use-workspace-roles')
vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        members: {
          inviteEmail: {
            post: {
              mutationOptions: () => ({ mutationFn: inviteMember }),
            },
          },
        },
      },
    },
  },
}))

describe('InviteModal', () => {
  const onOpenChange = vi.fn()
  const onSend = vi.fn()
  const refreshLicenseLimit = vi.fn()

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
            ],
            pagination: {
              total_count: 1,
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
    vi.mocked(useProviderContextSelector).mockImplementation((selector) =>
      selector({
        licenseLimit: { workspace_members: { size: 5, limit: 10 } },
        refreshLicenseLimit,
      } as unknown as Parameters<typeof selector>[0]),
    )
  })

  const renderModal = ({
    open = true,
    isEmailSetup = true,
    queryClient = createQueryClient(),
  }: {
    open?: boolean
    isEmailSetup?: boolean
    queryClient?: QueryClient
  } = {}) =>
    render(
      <QueryClientProvider client={queryClient}>
        <InviteModal
          open={open}
          trigger={<button type="button">members.invite</button>}
          isEmailSetup={isEmailSetup}
          onOpenChange={onOpenChange}
          onSend={onSend}
        />
      </QueryClientProvider>,
    )

  const selectAdminRole = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('combobox', { name: /members\.role/i }))
    await user.click(screen.getByRole('option', { name: /Admin/i }))
  }

  const addRecipients = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.click(input)
    await user.paste(value)
  }

  it('renders a labeled form inside a controlled dialog', () => {
    renderModal()

    const dialog = screen.getByRole('dialog', { name: /members\.inviteTeamMember$/i })
    expect(within(dialog).getByText(/members\.inviteTeamMemberTip/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('form')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('textbox', { name: /members\.emailRecipients/i }),
    ).toHaveAttribute('inputmode', 'email')
  })

  it('should place initial focus in the email composer', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /members\.emailRecipients/i })).toHaveFocus()
    })
  })

  it('should focus the email field first when the untouched form is submitted with Enter', async () => {
    const user = userEvent.setup()
    renderModal()

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await waitFor(() => expect(input).toHaveFocus())
    await user.keyboard('{Enter}')

    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/members\.emailRequired/i)).toBeInTheDocument()
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('does not render dialog content while controlled closed', () => {
    renderModal({ open: false })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the email service warning in the form', () => {
    renderModal({ isEmailSetup: false })

    expect(screen.getByText(/members\.emailNotSetup/i)).toBeInTheDocument()
  })

  it('submits normalized, deduplicated recipients with the selected Role id', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    renderModal()

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
    expect(refreshLicenseLimit).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSend).toHaveBeenCalledWith([])
  })

  it('submits a valid draft without requiring Enter or blur to create a chip', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    renderModal()

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
    renderModal()

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
    renderModal()

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
    renderModal()

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
    renderModal()

    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await user.type(input, 'person@example{Enter}')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => expect(inviteMember).toHaveBeenCalled())
  })

  it('keeps invalid recipients visible and blocks the whole submission', async () => {
    const user = userEvent.setup()
    renderModal()

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
    renderModal()

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
    renderModal()

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
    renderModal()

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
    renderModal()

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

    await act(async () => {
      resolveInvite({
        result: 'success',
        invitation_results: [],
        tenant_id: 'tenant-id',
      })
    })
  })

  it('warns but lets the backend decide whether recipients consume remaining seats', async () => {
    const user = userEvent.setup()
    vi.mocked(useProviderContextSelector).mockImplementation((selector) =>
      selector({
        licenseLimit: { workspace_members: { size: 9, limit: 10 } },
        refreshLicenseLimit,
      } as unknown as Parameters<typeof selector>[0]),
    )
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    } satisfies MemberInviteResponse)
    renderModal()

    await addRecipients(user, 'one@example.com, two@example.com')
    await selectAdminRole(user)

    expect(screen.getByText(/members\.recipientCountExceedsSeats/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))
    await waitFor(() => expect(inviteMember).toHaveBeenCalled())
  })

  it('counts a manually typed recipient list before it is committed', async () => {
    const user = userEvent.setup()
    vi.mocked(useProviderContextSelector).mockImplementation((selector) =>
      selector({
        licenseLimit: { workspace_members: { size: 9, limit: 10 } },
        refreshLicenseLimit,
      } as unknown as Parameters<typeof selector>[0]),
    )
    renderModal()

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
    ['invalid-role', /members\.invalidRole/i, 'role', 'combobox'],
  ])('maps %s server validation to the owning field', async (code, message, fieldName, role) => {
    const user = userEvent.setup()
    inviteMember.mockRejectedValue({
      code: 'BAD_REQUEST',
      data: { body: { code, message: 'Backend message' } },
    })
    renderModal()

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
    expect(onOpenChange).not.toHaveBeenCalled()
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
    renderModal()

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

  it('keeps unknown request failures as a persistent form error', async () => {
    const user = userEvent.setup()
    inviteMember.mockRejectedValue(new Error('Network failed'))
    renderModal()

    await addRecipients(user, 'user@example.com, another@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/members\.inviteFailed/i)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('routes close actions through the controlled state owner', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /operation\.close/i }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('resets the form after a controlled close', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const ControlledInviteModal = () => {
      const [open, setOpen] = useState(false)

      return (
        <QueryClientProvider client={queryClient}>
          <InviteModal
            open={open}
            trigger={<button type="button">members.invite</button>}
            isEmailSetup
            onOpenChange={setOpen}
            onSend={onSend}
          />
        </QueryClientProvider>
      )
    }
    render(<ControlledInviteModal />)

    const trigger = screen.getByRole('button', { name: /members\.invite$/i })
    await user.click(trigger)
    await addRecipients(user, 'person@example.com, another@example.com')
    await user.click(screen.getByRole('button', { name: /operation\.close/i }))

    await waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    expect(screen.queryByText('person@example.com')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /members\.role/i })).toHaveTextContent(
      /members\.selectRole/i,
    )
  })
})
