import type { AgentComposerAgentResponse } from '@dify/contracts/api/console/apps/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { SaveInlineAgentToRosterDialog } from '../save-inline-agent-to-roster-dialog'

const mutateRequest = vi.hoisted(() => vi.fn())

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: toastMock,
}))

vi.mock('@/app/components/base/icon-picker', () => import('@/test/icon-picker-mock'))

const inlineAgent: AgentComposerAgentResponse = {
  active_config_snapshot_id: 'snapshot-1',
  description: 'Drafts tender clarifications.',
  icon: '🤖',
  icon_background: '#F5F3FF',
  icon_type: 'emoji',
  id: 'inline-agent-1',
  name: 'Inline Tender Agent',
  role: 'Tender Analyst',
  scope: 'workflow_only',
  status: 'active',
}

const renderDialog = (agent: AgentComposerAgentResponse = inlineAgent) => {
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()

  render(
    <SaveInlineAgentToRosterDialog
      resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}
      initialAgent={agent}
      nodeId="node-1"
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  )

  return { onOpenChange, onSaved }
}

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.saveToRoster.post': mutateRequest,
      'snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.saveToRoster.post':
        mutateRequest,
    }),
  }
})

describe('SaveInlineAgentToRosterDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateRequest.mockReset().mockResolvedValue({
      id: 'agent-1',
      binding: { agent_id: 'roster-agent-1', binding_type: 'roster_agent' },
    })
  })

  it('initializes the roster name empty while keeping the other inline agent metadata', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', {
      name: 'agentRoster.roster.saveToRosterDialog.title',
    })
    const nameInput = within(dialog).getByRole('textbox', {
      name: 'agentRoster.roster.createForm.nameLabel',
    })
    expect(nameInput).toHaveValue('')
    expect(
      within(dialog).getByRole('textbox', {
        name: 'agentRoster.roster.createForm.roleLabel common.label.optional',
      }),
    ).toHaveValue('Tender Analyst')
    expect(
      within(dialog).getByPlaceholderText('agentRoster.roster.createForm.descriptionPlaceholder'),
    ).toHaveValue('Drafts tender clarifications.')

    await user.type(nameInput, 'Roster Tender Agent')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
        node_id: 'node-1',
      },
      body: {
        variant: 'workflow',
        save_strategy: 'save_to_roster',
        new_agent_name: 'Roster Tender Agent',
        description: 'Drafts tender clarifications.',
        role: 'Tender Analyst',
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#F5F3FF',
      },
    })
  })

  it('saves the inline agent to roster through the snippet composer API', async () => {
    const user = userEvent.setup()
    render(
      <SaveInlineAgentToRosterDialog
        resource={{ kind: 'snippet', snippetId: 'snippet-1' }}
        initialAgent={inlineAgent}
        nodeId="node-1"
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', {
      name: 'agentRoster.roster.saveToRosterDialog.title',
    })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
      'Snippet Agent',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      params: {
        snippet_id: 'snippet-1',
        node_id: 'node-1',
      },
      body: expect.objectContaining({
        variant: 'workflow',
        save_strategy: 'save_to_roster',
        new_agent_name: 'Snippet Agent',
      }),
    })
  })

  it('submits the visible default icon when the inline agent has no icon metadata', async () => {
    const user = userEvent.setup()
    renderDialog({
      ...inlineAgent,
      icon: null,
      icon_background: null,
      icon_type: null,
    })

    const dialog = screen.getByRole('dialog', {
      name: 'agentRoster.roster.saveToRosterDialog.title',
    })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
      'Roster Tender Agent',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
        node_id: 'node-1',
      },
      body: {
        variant: 'workflow',
        save_strategy: 'save_to_roster',
        new_agent_name: 'Roster Tender Agent',
        description: 'Drafts tender clarifications.',
        role: 'Tender Analyst',
        icon_type: 'emoji',
        icon: '🧸',
        icon_background: '#F5F3FF',
      },
    })
  })

  it('initializes the icon picker from the inline agent and submits changed icon fields', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', {
      name: 'agentRoster.roster.saveToRosterDialog.title',
    })
    await user.click(
      within(dialog).getByRole('button', {
        name: 'agentRoster.roster.saveToRosterForm.changeIcon',
      }),
    )

    expect(screen.getByText('🤖:#F5F3FF')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { hidden: true, name: 'Select brain icon' }))
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
      'Roster Tender Agent',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
        node_id: 'node-1',
      },
      body: {
        variant: 'workflow',
        save_strategy: 'save_to_roster',
        new_agent_name: 'Roster Tender Agent',
        description: 'Drafts tender clarifications.',
        role: 'Tender Analyst',
        icon_type: 'emoji',
        icon: '🧠',
        icon_background: '#E0F2FE',
      },
    })
  })

  it('keeps one source snapshot while open and uses the latest agent after reopening', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSaved = vi.fn()
    const updatedInlineAgent = {
      ...inlineAgent,
      description: 'Updated source description.',
      icon: '🦊',
      icon_background: '#FFEDD5',
      role: 'Updated source role',
    }
    const { rerender } = render(
      <SaveInlineAgentToRosterDialog
        resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}
        initialAgent={inlineAgent}
        nodeId="node-1"
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )

    rerender(
      <SaveInlineAgentToRosterDialog
        resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}
        initialAgent={updatedInlineAgent}
        nodeId="node-1"
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )

    let dialog = screen.getByRole('dialog', {
      name: 'agentRoster.roster.saveToRosterDialog.title',
    })
    expect(
      within(dialog).getByRole('textbox', {
        name: 'agentRoster.roster.createForm.roleLabel common.label.optional',
      }),
    ).toHaveValue('Tender Analyst')
    await user.click(
      within(dialog).getByRole('button', {
        name: 'agentRoster.roster.saveToRosterForm.changeIcon',
      }),
    )
    expect(screen.getByText('🤖:#F5F3FF')).toBeInTheDocument()

    rerender(
      <SaveInlineAgentToRosterDialog
        resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}
        initialAgent={updatedInlineAgent}
        nodeId="node-1"
        open={false}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    rerender(
      <SaveInlineAgentToRosterDialog
        resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}
        initialAgent={updatedInlineAgent}
        nodeId="node-1"
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )
    dialog = screen.getByRole('dialog', {
      name: 'agentRoster.roster.saveToRosterDialog.title',
    })
    expect(
      within(dialog).getByRole('textbox', {
        name: 'agentRoster.roster.createForm.roleLabel common.label.optional',
      }),
    ).toHaveValue('Updated source role')
    await user.click(
      within(dialog).getByRole('button', {
        name: 'agentRoster.roster.saveToRosterForm.changeIcon',
      }),
    )
    expect(screen.getByText('🦊:#FFEDD5')).toBeInTheDocument()
  })

  it('returns only the saved roster agent id after a successful save', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onSaved } = renderDialog()

    const dialog = screen.getByRole('dialog', {
      name: 'agentRoster.roster.saveToRosterDialog.title',
    })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
      'Roster Tender Agent',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('roster-agent-1'))

    expect(onSaved).toHaveBeenCalledWith('roster-agent-1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})
