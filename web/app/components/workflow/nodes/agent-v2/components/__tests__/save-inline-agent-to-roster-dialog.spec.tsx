import type { AgentComposerAgentResponse } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    initialEmoji?: { icon: string, background: string }
    onSelect: (payload: { type: 'emoji', icon: string, background: string }) => void
    open: boolean
  }) => open
    ? (
        <div>
          <span>{`${initialEmoji?.icon}:${initialEmoji?.background}`}</span>
          <button
            type="button"
            onClick={() => onSelect({ type: 'emoji', icon: '🧠', background: '#E0F2FE' })}
          >
            Select brain icon
          </button>
        </div>
      )
    : null,
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
      appId="app-1"
      formKey={1}
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
    const nameInput = within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' })
    expect(nameInput).toHaveValue('')
    expect(within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.roleLabel' })).toHaveValue('Tender Analyst')
    expect(within(dialog).getByPlaceholderText('agentV2.roster.createForm.descriptionPlaceholder')).toHaveValue('Drafts tender clarifications.')

    await user.type(nameInput, 'Roster Tender Agent')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith({
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
    }, expect.objectContaining({
      onSuccess: expect.any(Function),
    }))
    const mutationOptions = mutationMock.mutate.mock.calls[0]?.[1]
    expect(mutationOptions).not.toHaveProperty('onError')
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
    await user.type(within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }), 'Roster Tender Agent')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith({
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
    }, expect.objectContaining({
      onSuccess: expect.any(Function),
    }))
  })

  it('initializes the icon picker from the inline agent and submits changed icon fields', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.saveToRosterDialog.title' })
    await user.click(within(dialog).getByRole('button', { name: 'agentV2.roster.saveToRosterForm.changeIcon' }))

    expect(screen.getByText('🤖:#F5F3FF')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { hidden: true, name: 'Select brain icon' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }), 'Roster Tender Agent')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith({
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
    }, expect.objectContaining({
      onSuccess: expect.any(Function),
    }))
  })
})
