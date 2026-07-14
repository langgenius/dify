import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditAgentDialog } from '../edit-agent-dialog'

const mutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
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
    onSelect,
    open,
  }: {
    onSelect: (payload: { type: 'emoji'; icon: string; background: string }) => void
    open: boolean
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => onSelect({ type: 'emoji', icon: '🧠', background: '#E0F2FE' })}
      >
        Select brain icon
      </button>
    ) : null,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        put: {
          mutationOptions: vi.fn(() => ({})),
        },
      },
    },
  },
}))

const createAgent = (overrides: Partial<AgentAppPartial> = {}): AgentAppPartial => ({
  description: 'Find and summarize market materials.',
  icon: '🧸',
  icon_background: '#F5F3FF',
  icon_type: 'emoji',
  id: 'agent-1',
  icon_url: null,
  mode: 'agent',
  name: 'Research Agent',
  role: 'Research Assistant',
  ...overrides,
})

const renderDialog = (agent = createAgent()) => {
  const onOpenChange = vi.fn()

  render(<EditAgentDialog agent={agent} formKey={0} open onOpenChange={onOpenChange} />)

  return { onOpenChange }
}

describe('EditAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutationMock.isPending = false
  })

  it('submits the full agent payload when only the name changes', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    await user.clear(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
      ' Market Agent ',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
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
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
    const mutationOptions = mutationMock.mutate.mock.calls[0]?.[1]
    expect(mutationOptions).not.toHaveProperty('onError')
  })

  it('submits the full agent payload when only the role changes', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    await user.clear(
      within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.roleLabel/ }),
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.roleLabel/ }),
      ' Market Analyst ',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
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
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
    const mutationOptions = mutationMock.mutate.mock.calls[0]?.[1]
    expect(mutationOptions).not.toHaveProperty('onError')
  })

  it('submits selected icon fields when the roster icon changes', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    await user.click(within(dialog).getByRole('button', { name: /agentV2\.roster\.editAgent/ }))
    await user.click(screen.getByRole('button', { hidden: true, name: 'Select brain icon' }))
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
        params: {
          agent_id: 'agent-1',
        },
        body: {
          name: 'Research Agent',
          description: 'Find and summarize market materials.',
          role: 'Research Assistant',
          icon_type: 'emoji',
          icon: '🧠',
          icon_background: '#E0F2FE',
        },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
    const mutationOptions = mutationMock.mutate.mock.calls[0]?.[1]
    expect(mutationOptions).not.toHaveProperty('onError')
  })

  it('shows a field error when saving with an empty name', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    await user.clear(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }),
    )

    const saveButton = within(dialog).getByRole('button', { name: 'common.operation.save' })
    expect(saveButton).not.toBeDisabled()
    await user.click(saveButton)

    expect(
      await within(dialog).findByText('agentV2.roster.createForm.nameRequired'),
    ).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(mutationMock.mutate).not.toHaveBeenCalled()
  })

  it('marks role and description as optional', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.editDialog.title' })

    expect(
      within(dialog).getByRole('textbox', {
        name: /agentV2\.roster\.createForm\.roleLabel.*common\.label\.optional/,
      }),
    ).not.toBeRequired()
    expect(
      within(dialog).getByRole('textbox', {
        name: /agentV2\.roster\.createForm\.descriptionLabel.*common\.label\.optional/,
      }),
    ).not.toBeRequired()
  })

  it('submits an empty role when the role is cleared', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    await user.clear(
      within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.roleLabel/ }),
    )

    const saveButton = within(dialog).getByRole('button', { name: 'common.operation.save' })
    expect(saveButton).not.toBeDisabled()
    await user.click(saveButton)

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
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
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
  })

  it('keeps the form open when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    const backdrop = document.body.querySelector('.bg-background-overlay') as HTMLElement
    await user.click(backdrop)

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(dialog).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
