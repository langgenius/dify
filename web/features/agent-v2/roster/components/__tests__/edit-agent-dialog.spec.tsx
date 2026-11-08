import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockEmojiData, renderWithEmoji as render } from '@/test/emoji-picker'
import { EditAgentDialog } from '../edit-agent-dialog'

const mutateRequest = vi.hoisted(() => vi.fn())

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: toastMock,
}))

mockEmojiData()

const createAgent = (overrides: Partial<AgentAppPartial> = {}): AgentAppPartial => ({
  description: 'Find and summarize market materials.',
  icon: '🧸',
  icon_background: '#F5F3FF',
  icon_type: 'emoji',
  id: 'agent-1',
  icon_url: null,
  mode: 'agent',
  name: 'Research Agent',
  permission_keys: [],
  role: 'Research Assistant',
  ...overrides,
})

const renderDialog = (agent = createAgent()) => {
  const onOpenChange = vi.fn()

  const renderResult = render(<EditAgentDialog agent={agent} open onOpenChange={onOpenChange} />)

  return { ...renderResult, onOpenChange }
}

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.put': mutateRequest,
    }),
  }
})

describe('EditAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateRequest.mockReset().mockResolvedValue({
      id: 'agent-1',
      binding: { agent_id: 'roster-agent-1', binding_type: 'roster_agent' },
    })
  })

  it('submits the full agent payload when only the name changes', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
    await user.clear(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
      ' Market Agent ',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      body: {
        name: 'Market Agent',
        description: 'Find and summarize market materials.',
        role: 'Research Assistant',
        icon_type: 'emoji',
        icon: '🧸',
        icon_background: '#F5F3FF',
      },
    })

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('submits the full agent payload when only the role changes', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
    await user.clear(
      within(dialog).getByRole('textbox', { name: /agentRoster\.roster\.createForm\.roleLabel/ }),
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: /agentRoster\.roster\.createForm\.roleLabel/ }),
      ' Market Analyst ',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      body: {
        name: 'Research Agent',
        description: 'Find and summarize market materials.',
        role: 'Market Analyst',
        icon_type: 'emoji',
        icon: '🧸',
        icon_background: '#F5F3FF',
      },
    })
  })

  it('keeps the original form snapshot when the agent source changes while open', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const agent = createAgent()
    const { rerender } = render(<EditAgentDialog agent={agent} open onOpenChange={onOpenChange} />)

    let dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
    expect(within(dialog).getByRole('button', { name: 'common.operation.save' })).toBeDisabled()

    rerender(
      <EditAgentDialog
        agent={createAgent({ icon: '🦊', icon_background: '#FFEDD5' })}
        open
        onOpenChange={onOpenChange}
      />,
    )

    dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
    expect(within(dialog).getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
    expect(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
    ).toHaveValue('Research Agent')
    await user.click(
      within(dialog).getByRole('button', {
        name: 'agentRoster.roster.createForm.changeIcon',
      }),
    )
    const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    await user.type(
      within(dialog).getByRole('textbox', {
        name: 'agentRoster.roster.createForm.nameLabel',
      }),
      ' edited',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
    expect(mutateRequest).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      body: expect.objectContaining({
        name: 'Research Agent edited',
        icon: '🧸',
        icon_background: '#F5F3FF',
      }),
    })
  })

  it('keeps a user-selected icon when the agent source changes during the session', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <EditAgentDialog agent={createAgent()} open onOpenChange={onOpenChange} />,
    )

    const dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
    await user.click(
      within(dialog).getByRole('button', {
        name: 'agentRoster.roster.createForm.changeIcon',
      }),
    )
    const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
    await user.click(within(picker).getByRole('radio', { name: 'app.iconPicker.color.green' }))
    await user.click(within(picker).getByRole('button', { name: 'app.iconPicker.ok' }))
    await waitFor(() => expect(picker).not.toBeInTheDocument())

    rerender(
      <EditAgentDialog
        agent={createAgent({ icon: '🦊', icon_background: '#FFEDD5' })}
        open
        onOpenChange={onOpenChange}
      />,
    )

    expect(
      within(screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })).getByRole(
        'button',
        { name: 'common.operation.save' },
      ),
    ).not.toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
    expect(mutateRequest).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      body: expect.objectContaining({ icon: '🧸', icon_background: '#F3FEE7' }),
    })
  })

  it('creates a fresh form session from the latest agent after closing', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const agent = createAgent()
    const { rerender } = render(<EditAgentDialog agent={agent} open onOpenChange={onOpenChange} />)

    const dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
    await user.click(
      within(dialog).getByRole('button', {
        name: 'agentRoster.roster.createForm.changeIcon',
      }),
    )
    const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
    await user.click(within(picker).getByRole('radio', { name: 'app.iconPicker.color.green' }))
    await user.click(within(picker).getByRole('button', { name: 'app.iconPicker.ok' }))
    await waitFor(() => expect(picker).not.toBeInTheDocument())

    rerender(<EditAgentDialog agent={agent} open={false} onOpenChange={onOpenChange} />)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    rerender(
      <EditAgentDialog
        agent={createAgent({ icon: '🦊', icon_background: '#FFEDD5' })}
        open
        onOpenChange={onOpenChange}
      />,
    )
    const reopenedDialog = screen.getByRole('dialog', {
      name: 'agentRoster.roster.editDialog.title',
    })
    await user.type(
      within(reopenedDialog).getByRole('textbox', {
        name: 'agentRoster.roster.createForm.nameLabel',
      }),
      ' edited',
    )
    await user.click(within(reopenedDialog).getByRole('button', { name: 'common.operation.save' }))
    expect(mutateRequest).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      body: expect.objectContaining({
        name: 'Research Agent edited',
        icon: '🦊',
        icon_background: '#FFEDD5',
      }),
    })
  })

  it('starts a new form session when the agent identity changes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <EditAgentDialog agent={createAgent()} open onOpenChange={onOpenChange} />,
    )

    rerender(
      <EditAgentDialog
        agent={createAgent({
          description: 'Second description',
          icon: '🦊',
          icon_background: '#FFEDD5',
          id: 'agent-2',
          name: 'Second Agent',
          role: 'Second Role',
        })}
        open
        onOpenChange={onOpenChange}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
    const nameInput = within(dialog).getByRole('textbox', {
      name: 'agentRoster.roster.createForm.nameLabel',
    })
    expect(nameInput).toHaveValue('Second Agent')
    expect(within(dialog).getByRole('button', { name: 'common.operation.save' })).toBeDisabled()

    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed Second Agent')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-2',
      },
      body: {
        name: 'Renamed Second Agent',
        description: 'Second description',
        role: 'Second Role',
        icon_type: 'emoji',
        icon: '🦊',
        icon_background: '#FFEDD5',
      },
    })
  })

  it('shows a field error when saving with an empty name', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
    await user.clear(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
    )

    const saveButton = within(dialog).getByRole('button', { name: 'common.operation.save' })
    expect(saveButton).not.toBeDisabled()
    await user.click(saveButton)

    expect(
      await within(dialog).findByText('agentRoster.roster.createForm.nameRequired'),
    ).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(mutateRequest).not.toHaveBeenCalled()
  })

  it('submits an empty role when the role is cleared', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
    await user.clear(
      within(dialog).getByRole('textbox', { name: /agentRoster\.roster\.createForm\.roleLabel/ }),
    )

    const saveButton = within(dialog).getByRole('button', { name: 'common.operation.save' })
    expect(saveButton).not.toBeDisabled()
    await user.click(saveButton)

    expect(mutateRequest).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      body: {
        name: 'Research Agent',
        description: 'Find and summarize market materials.',
        role: '',
        icon_type: 'emoji',
        icon: '🧸',
        icon_background: '#F5F3FF',
      },
    })
  })
})
