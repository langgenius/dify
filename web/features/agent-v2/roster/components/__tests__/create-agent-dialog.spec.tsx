import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentScope } from '@/features/agent-v2/analytics'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { CreateAgentDialog } from '../create-agent-dialog'

const mutateRequest = vi.hoisted(() => vi.fn())

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

const routerPushMock = vi.hoisted(() => vi.fn())

const trackCreateAppMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/notifications', () => ({
  toast: toastMock,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: trackCreateAppMock,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.post': mutateRequest,
    }),
  }
})

describe('CreateAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateRequest.mockReset().mockResolvedValue({
      id: 'agent-1',
      binding: { agent_id: 'roster-agent-1', binding_type: 'roster_agent' },
    })
  })

  it('creates an agent with trimmed fields and default icon, then opens its configure page', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    await user.click(screen.getByRole('button', { name: /agentRoster\.roster\.createAgent/ }))

    const dialog = await screen.findByRole('dialog', {
      name: 'agentRoster.roster.createDialog.title',
    })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
      ' Research Agent ',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: /agentRoster\.roster\.createForm\.roleLabel/ }),
      ' Research Assistant ',
    )
    await user.type(
      within(dialog).getByPlaceholderText('agentRoster.roster.createForm.descriptionPlaceholder'),
      ' Find and summarize market materials. ',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      body: {
        name: 'Research Agent',
        description: 'Find and summarize market materials.',
        role: 'Research Assistant',
        icon_type: 'emoji',
        icon: '🧸',
        icon_background: '#F5F3FF',
      },
    })

    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith('/agents/agent-1/configure'))
    expect(trackCreateAppMock).toHaveBeenCalledWith({
      source: 'studio_blank',
      appMode: 'agent-v2',
      agentScope: AgentScope.Global,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('shows a field error when creating with an empty name', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    await user.click(screen.getByRole('button', { name: /agentRoster\.roster\.createAgent/ }))

    const dialog = await screen.findByRole('dialog', {
      name: 'agentRoster.roster.createDialog.title',
    })
    await user.type(
      within(dialog).getByRole('textbox', { name: /agentRoster\.roster\.createForm\.roleLabel/ }),
      'Research Assistant',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(
      await within(dialog).findByText('agentRoster.roster.createForm.nameRequired'),
    ).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(mutateRequest).not.toHaveBeenCalled()
  })

  it('focuses the name field when opened and resets native form values after closing', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    const trigger = screen.getByRole('button', { name: /agentRoster\.roster\.createAgent/ })
    await user.click(trigger)

    let dialog = await screen.findByRole('dialog', {
      name: 'agentRoster.roster.createDialog.title',
    })
    const nameInput = within(dialog).getByRole('textbox', {
      name: 'agentRoster.roster.createForm.nameLabel',
    })
    const descriptionInput = within(dialog).getByRole('textbox', {
      name: /agentRoster\.roster\.createForm\.descriptionLabel/,
    })
    expect(nameInput).toHaveFocus()

    await user.type(nameInput, 'Temporary Agent')
    await user.type(descriptionInput, 'Temporary description')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'agentRoster.roster.createDialog.title' }),
      ).not.toBeInTheDocument()
    })

    await user.click(trigger)
    dialog = await screen.findByRole('dialog', { name: 'agentRoster.roster.createDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
    ).toHaveValue('')
    expect(
      within(dialog).getByRole('textbox', {
        name: /agentRoster\.roster\.createForm\.descriptionLabel/,
      }),
    ).toHaveValue('')
  })

  it('allows creation without optional role and description', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    await user.click(screen.getByRole('button', { name: /agentRoster\.roster\.createAgent/ }))

    const dialog = await screen.findByRole('dialog', {
      name: 'agentRoster.roster.createDialog.title',
    })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
      'Research Agent',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      body: {
        name: 'Research Agent',
        description: '',
        role: '',
        icon_type: 'emoji',
        icon: '🧸',
        icon_background: '#F5F3FF',
      },
    })
  })
})
