import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { IconPickerInputValue, IconPickerValue } from '@/app/components/base/icon-picker'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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

vi.mock('@/app/components/base/icon-picker', () => ({
  IconPickerDialog: function Picker({
    value,
    'aria-label': label,
  }: {
    value?: IconPickerInputValue
    onConfirm: (value: IconPickerValue) => void
    'aria-label'?: string
  }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" aria-label={label} onClick={() => setOpen(true)}>
          {value?.type === 'emoji' ? `${value.icon}:${value.background}` : value?.type}
        </button>
        {open && <div></div>}
      </>
    )
  },
}))

vi.mock('@/service/console', () => ({
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
  permission_keys: [],
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

    let dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.duplicateDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
    ).toHaveValue('Research Agent copy')
    await user.click(
      within(dialog).getByRole('button', {
        name: /agentRoster\.roster\.duplicateForm\.changeIcon.*Research Agent/,
      }),
    )
    expect(screen.getByText('🧸:#F5F3FF')).toBeInTheDocument()

    rerender(<DuplicateAgentDialog agent={updatedAgent} open={false} onOpenChange={onOpenChange} />)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    rerender(<DuplicateAgentDialog agent={updatedAgent} open onOpenChange={onOpenChange} />)
    dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.duplicateDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
    ).toHaveValue('Updated Agent copy')
    await user.click(
      within(dialog).getByRole('button', {
        name: /agentRoster\.roster\.duplicateForm\.changeIcon.*Updated Agent/,
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

    const dialog = screen.getByRole('dialog', { name: 'agentRoster.roster.duplicateDialog.title' })
    expect(
      within(dialog).getByRole('textbox', { name: 'agentRoster.roster.createForm.nameLabel' }),
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
