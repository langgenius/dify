import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { createHttpError } from '@/service/http-error'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { InviteModal } from '../index'

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
    await renderModal()

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
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSend).toHaveBeenCalledWith([])
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
      expect(inviteMember).toHaveBeenCalledExactlyOnceWith({
        body: { emails: ['only@gmail.com'], role: 'admin', language: 'en-US' },
      })
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
    await user.click(await screen.findByRole('option', { name: /Admin/i }))
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

  it('closes once the invitation succeeds without waiting for the seat refresh', async () => {
    const user = userEvent.setup()
    inviteMember.mockResolvedValue({
      result: 'success',
      invitation_results: [],
      tenant_id: 'tenant-id',
    })
    await renderModal()
    // The refresh started by a successful invitation never settles.
    fetchFeatures.mockReturnValue(new Promise(() => {}))
    await addRecipients(user, 'person@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSend).toHaveBeenCalledExactlyOnceWith([])
    await waitFor(() => expect(fetchFeatures).toHaveBeenCalled())
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
    inviteMember.mockRejectedValue(
      createHttpError(new Response(null, { status: 400 }), {
        code,
        message: 'Backend message',
        status: 400,
      }),
    )
    await renderModal()

    await addRecipients(user, 'user@example.com, another@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(
      screen.getByRole(role, {
        name: fieldName === 'emails' ? /members\.emailRecipients/i : /members\.role/i,
      }),
    ).toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.getByRole(role, {
        name: fieldName === 'emails' ? /members\.emailRecipients/i : /members\.role/i,
      }),
    ).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps a role server error visible when the user only opens the selector', async () => {
    const user = userEvent.setup()
    inviteMember.mockRejectedValue(
      createHttpError(new Response(null, { status: 400 }), {
        code: 'invalid_role',
        message: 'Backend message',
        status: 400,
      }),
    )
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

  it('moves focus to the recipients when the server rejects them after the form was frozen', async () => {
    const user = userEvent.setup()
    let rejectInvite!: (error: unknown) => void
    inviteMember.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectInvite = reject
      }),
    )
    await renderModal()
    await addRecipients(user, 'first@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))
    const input = screen.getByRole('textbox', { name: /members\.emailRecipients/i })
    await waitFor(() => expect(input).toBeDisabled())

    await act(async () =>
      rejectInvite(
        createHttpError(new Response(null, { status: 400 }), {
          code: 'limit_exceeded',
          message: 'Backend message',
          status: 400,
        }),
      ),
    )

    expect(await screen.findByText(/members\.inviteLimitExceeded/i)).toBeInTheDocument()
    expect(input).toBeEnabled()
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('should clear an email server error when the user edits and successfully retries', async () => {
    const user = userEvent.setup()
    inviteMember
      .mockRejectedValueOnce(
        createHttpError(new Response(null, { status: 400 }), {
          code: 'limit_exceeded',
          message: 'Backend message',
          status: 400,
        }),
      )
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
      .mockRejectedValueOnce(
        createHttpError(new Response(null, { status: 400 }), {
          code: 'limit_exceeded',
          message: 'Backend message',
          status: 400,
        }),
      )
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
