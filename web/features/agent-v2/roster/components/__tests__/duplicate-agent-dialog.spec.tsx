import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockEmojiData, renderWithEmoji as render } from '@/test/emoji-picker'
import { DuplicateAgentDialog } from '../duplicate-agent-dialog'

const mutateRequest = vi.hoisted(() => vi.fn())

mockEmojiData()

const createAgent = (overrides: Partial<AgentAppPartial> = {}): AgentAppPartial => ({
  description: 'Original description',
  icon: '🧸',
  icon_background: '#F5F3FF',
  icon_type: 'emoji',
  icon_url: null,
  id: 'agent-1',
  mode: 'agent',
  name: 'Research Agent',
  permission_keys: [],
  role: 'Research Assistant',
  ...overrides,
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.copy.post': mutateRequest,
    }),
  }
})

describe('DuplicateAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateRequest.mockReset().mockResolvedValue({
      ...createAgent({ id: 'agent-copy-1' }),
      binding: { agent_id: 'roster-agent-1', binding_type: 'roster_agent' },
    })
  })

  it('keeps one form snapshot while open and creates a new session after closing', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const updatedAgent = createAgent({
      icon: '🦊',
      icon_background: '#FFEDD5',
      name: 'Updated Agent',
      role: 'Updated Role',
    })
    const { rerender } = render(
      <DuplicateAgentDialog agent={createAgent()} open onOpenChange={onOpenChange} />,
    )

    rerender(<DuplicateAgentDialog agent={updatedAgent} open onOpenChange={onOpenChange} />)

    let dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.duplicateDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
    ).toHaveValue('Research Agent copy')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.duplicate' }))
    await waitFor(() =>
      expect(mutateRequest).toHaveBeenCalledExactlyOnceWith({
        params: { agent_id: 'agent-1' },
        body: {
          name: 'Research Agent copy',
          description: 'Original description',
          role: 'Research Assistant',
          icon_type: 'emoji',
          icon: '🧸',
          icon_background: '#F5F3FF',
        },
      }),
    )

    rerender(<DuplicateAgentDialog agent={updatedAgent} open={false} onOpenChange={onOpenChange} />)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    rerender(<DuplicateAgentDialog agent={updatedAgent} open onOpenChange={onOpenChange} />)
    dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.duplicateDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
    ).toHaveValue('Updated Agent copy')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.duplicate' }))
    await waitFor(() =>
      expect(mutateRequest).toHaveBeenLastCalledWith({
        params: { agent_id: 'agent-1' },
        body: {
          name: 'Updated Agent copy',
          description: 'Original description',
          role: 'Updated Role',
          icon_type: 'emoji',
          icon: '🦊',
          icon_background: '#FFEDD5',
        },
      }),
    )
  })

  it('starts a new form session when the agent identity changes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const secondAgent = createAgent({
      description: 'Second description',
      id: 'agent-2',
      name: 'Second Agent',
      role: 'Second Role',
    })
    const { rerender } = render(
      <DuplicateAgentDialog agent={createAgent()} open onOpenChange={onOpenChange} />,
    )

    rerender(<DuplicateAgentDialog agent={secondAgent} open onOpenChange={onOpenChange} />)

    const dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.duplicateDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
    ).toHaveValue('Second Agent copy')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.duplicate' }))

    expect(mutateRequest).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-2',
      },
      body: {
        name: 'Second Agent copy',
        description: 'Second description',
        role: 'Second Role',
        icon_type: 'emoji',
        icon: '🧸',
        icon_background: '#F5F3FF',
      },
    })
  })
})
