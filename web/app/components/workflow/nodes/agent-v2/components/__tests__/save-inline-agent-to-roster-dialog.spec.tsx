import type { AgentComposerAgentResponse } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FlowType } from '@/types/common'
import { SaveInlineAgentToRosterDialog } from '../save-inline-agent-to-roster-dialog'

const mutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    isPending: mutationMock.isPending,
    mutate: mutationMock.mutate,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@/app/components/base/app-icon-picker', () => ({
  __esModule: true,
  default: ({
    initialEmoji,
    onSelect,
    open,
  }: {
    initialEmoji?: { icon: string; background: string }
    onSelect: (payload: { type: 'emoji'; icon: string; background: string }) => void
    open: boolean
  }) =>
    open ? (
      <div>
        <span>{`${initialEmoji?.icon}:${initialEmoji?.background}`}</span>
        <button
          type="button"
          onClick={() => onSelect({ type: 'emoji', icon: '🧠', background: '#E0F2FE' })}
        >
          Select brain icon
        </button>
      </div>
    ) : null,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        workflows: {
          draft: {
            nodes: {
              byNodeId: {
                agentComposer: {
                  saveToRoster: {
                    post: {
                      mutationOptions: vi.fn(() => ({})),
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    snippets: {
      bySnippetId: {
        workflows: {
          draft: {
            nodes: {
              byNodeId: {
                agentComposer: {
                  saveToRoster: {
                    post: {
                      mutationOptions: vi.fn(() => ({})),
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}))

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
      flowId="app-1"
      flowType={FlowType.appFlow}
      initialAgent={agent}
      nodeId="node-1"
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  )

  return { onOpenChange, onSaved }
}

describe('SaveInlineAgentToRosterDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutationMock.isPending = false
  })

  it('initializes the roster name empty while keeping the other inline agent metadata', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.saveToRosterDialog.title' })
    const nameInput = within(dialog).getByRole('textbox', {
      name: 'agentV2.roster.createForm.nameLabel',
    })
    expect(nameInput).toHaveValue('')
    expect(
      within(dialog).getByRole('textbox', {
        name: 'agentV2.roster.createForm.roleLabel common.label.optional',
      }),
    ).toHaveValue('Tender Analyst')
    expect(
      within(dialog).getByPlaceholderText('agentV2.roster.createForm.descriptionPlaceholder'),
    ).toHaveValue('Drafts tender clarifications.')

    await user.type(nameInput, 'Roster Tender Agent')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
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
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
    const mutationOptions = mutationMock.mutate.mock.calls[0]?.[1]
    expect(mutationOptions).not.toHaveProperty('onError')
  })

  it('saves the inline agent to roster through the snippet composer API', async () => {
    const user = userEvent.setup()
    render(
      <SaveInlineAgentToRosterDialog
        flowId="snippet-1"
        flowType={FlowType.snippet}
        initialAgent={inlineAgent}
        nodeId="node-1"
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.saveToRosterDialog.title' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
      'Snippet Agent',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
        params: {
          snippet_id: 'snippet-1',
          node_id: 'node-1',
        },
        body: expect.objectContaining({
          variant: 'workflow',
          save_strategy: 'save_to_roster',
          new_agent_name: 'Snippet Agent',
        }),
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
  })

  it('submits the visible default icon when the inline agent has no icon metadata', async () => {
    const user = userEvent.setup()
    renderDialog({
      ...inlineAgent,
      icon: null,
      icon_background: null,
      icon_type: null,
    })

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.saveToRosterDialog.title' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
      'Roster Tender Agent',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
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
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
  })

  it('initializes the icon picker from the inline agent and submits changed icon fields', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.saveToRosterDialog.title' })
    await user.click(
      within(dialog).getByRole('button', { name: 'agentV2.roster.saveToRosterForm.changeIcon' }),
    )

    expect(screen.getByText('🤖:#F5F3FF')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { hidden: true, name: 'Select brain icon' }))
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
      'Roster Tender Agent',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
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
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
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
        flowId="app-1"
        flowType={FlowType.appFlow}
        initialAgent={inlineAgent}
        nodeId="node-1"
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )

    rerender(
      <SaveInlineAgentToRosterDialog
        flowId="app-1"
        flowType={FlowType.appFlow}
        initialAgent={updatedInlineAgent}
        nodeId="node-1"
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )

    let dialog = screen.getByRole('dialog', {
      name: 'agentV2.roster.saveToRosterDialog.title',
    })
    expect(
      within(dialog).getByRole('textbox', {
        name: 'agentV2.roster.createForm.roleLabel common.label.optional',
      }),
    ).toHaveValue('Tender Analyst')
    await user.click(
      within(dialog).getByRole('button', {
        name: 'agentV2.roster.saveToRosterForm.changeIcon',
      }),
    )
    expect(screen.getByText('🤖:#F5F3FF')).toBeInTheDocument()

    rerender(
      <SaveInlineAgentToRosterDialog
        flowId="app-1"
        flowType={FlowType.appFlow}
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
        flowId="app-1"
        flowType={FlowType.appFlow}
        initialAgent={updatedInlineAgent}
        nodeId="node-1"
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    )
    dialog = screen.getByRole('dialog', {
      name: 'agentV2.roster.saveToRosterDialog.title',
    })
    expect(
      within(dialog).getByRole('textbox', {
        name: 'agentV2.roster.createForm.roleLabel common.label.optional',
      }),
    ).toHaveValue('Updated source role')
    await user.click(
      within(dialog).getByRole('button', {
        name: 'agentV2.roster.saveToRosterForm.changeIcon',
      }),
    )
    expect(screen.getByText('🦊:#FFEDD5')).toBeInTheDocument()
  })

  it('returns only the saved roster agent id after a successful save', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onSaved } = renderDialog()

    const dialog = screen.getByRole('dialog', {
      name: 'agentV2.roster.saveToRosterDialog.title',
    })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
      'Roster Tender Agent',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    const mutationOptions = mutationMock.mutate.mock.calls[0]?.[1]
    mutationOptions.onSuccess({
      binding: {
        agent_id: 'roster-agent-1',
        binding_type: 'roster_agent',
      },
    })

    expect(onSaved).toHaveBeenCalledWith('roster-agent-1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})
