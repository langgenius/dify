import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DuplicateAgentDialog } from '../duplicate-agent-dialog'

const queryDataMock = vi.hoisted(() => vi.fn())
const mutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => mutationMock,
  useQueryClient: () => ({
    getQueryData: queryDataMock,
  }),
}))

vi.mock('@/app/components/base/app-icon-picker', () => ({
  __esModule: true,
  default: ({
    initialEmoji,
    open,
  }: {
    initialEmoji?: { icon: string; background: string }
    open: boolean
  }) => (open ? <span>{`${initialEmoji?.icon}:${initialEmoji?.background}`}</span> : null),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        copy: {
          post: {
            mutationOptions: vi.fn(() => ({})),
          },
        },
        get: {
          queryKey: vi.fn(() => ['agent']),
        },
      },
    },
  },
}))

const createAgent = (overrides: Partial<AgentAppPartial> = {}): AgentAppPartial => ({
  description: 'Original description',
  icon: '🧸',
  icon_background: '#F5F3FF',
  icon_type: 'emoji',
  icon_url: null,
  id: 'agent-1',
  mode: 'agent',
  name: 'Research Agent',
  role: 'Research Assistant',
  ...overrides,
})

describe('DuplicateAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutationMock.isPending = false
    queryDataMock.mockReturnValue(undefined)
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

    let dialog = screen.getByRole('dialog', { name: 'agentV2.roster.duplicateDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
    ).toHaveValue('Research Agent copy')
    await user.click(
      within(dialog).getByRole('button', {
        name: /agentV2\.roster\.duplicateForm\.changeIcon.*Research Agent/,
      }),
    )
    expect(screen.getByText('🧸:#F5F3FF')).toBeInTheDocument()

    rerender(<DuplicateAgentDialog agent={updatedAgent} open={false} onOpenChange={onOpenChange} />)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    rerender(<DuplicateAgentDialog agent={updatedAgent} open onOpenChange={onOpenChange} />)
    dialog = screen.getByRole('dialog', { name: 'agentV2.roster.duplicateDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
    ).toHaveValue('Updated Agent copy')
    await user.click(
      within(dialog).getByRole('button', {
        name: /agentV2\.roster\.duplicateForm\.changeIcon.*Updated Agent/,
      }),
    )
    expect(screen.getByText('🦊:#FFEDD5')).toBeInTheDocument()
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

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.duplicateDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
    ).toHaveValue('Second Agent copy')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.duplicate' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
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
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
  })
})
