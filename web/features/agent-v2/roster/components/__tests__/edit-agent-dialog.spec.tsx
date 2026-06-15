import type { AppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditAgentDialog } from '../edit-agent-dialog'

const mutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    isPending: mutationMock.isPending,
    mutate: mutationMock.mutate,
  }),
}))

vi.mock('@/app/components/base/app-icon-picker', () => ({
  __esModule: true,
  default: ({
    onSelect,
    open,
  }: {
    onSelect: (payload: { type: 'emoji', icon: string, background: string }) => void
    open: boolean
  }) => open
    ? (
        <button
          type="button"
          onClick={() => onSelect({ type: 'emoji', icon: '🧠', background: '#E0F2FE' })}
        >
          Select brain icon
        </button>
      )
    : null,
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

const createAgent = (overrides: Partial<AppPartial> = {}): AppPartial => ({
  description: 'Find and summarize market materials.',
  icon: '🧸',
  icon_background: '#F5F3FF',
  icon_type: 'emoji',
  id: 'agent-1',
  icon_url: null,
  mode: 'agent',
  name: 'Research Agent',
  ...overrides,
})

const renderDialog = (agent = createAgent()) => {
  const onOpenChange = vi.fn()

  render(
    <EditAgentDialog
      agent={agent}
      open
      onOpenChange={onOpenChange}
    />,
  )

  return { onOpenChange }
}

describe('EditAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutationMock.isPending = false
  })

  it('submits changed app fields without resending unchanged icon fields', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    await user.clear(within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }), ' Market Agent ')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      body: {
        name: 'Market Agent',
        description: 'Find and summarize market materials.',
      },
    }, expect.objectContaining({
      onError: expect.any(Function),
      onSuccess: expect.any(Function),
    }))
  })

  it('submits selected icon fields when the roster icon changes', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    await user.click(within(dialog).getByRole('button', { name: /agentV2\.roster\.editAgent/ }))
    await user.click(screen.getByRole('button', { hidden: true, name: 'Select brain icon' }))
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      body: {
        name: 'Research Agent',
        description: 'Find and summarize market materials.',
        icon_type: 'emoji',
        icon: '🧠',
        icon_background: '#E0F2FE',
      },
    }, expect.objectContaining({
      onError: expect.any(Function),
      onSuccess: expect.any(Function),
    }))
  })
})
