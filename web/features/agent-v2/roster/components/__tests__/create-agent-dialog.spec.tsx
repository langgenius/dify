import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateAgentDialog } from '../create-agent-dialog'

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

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      post: {
        mutationOptions: vi.fn(() => ({})),
      },
    },
  },
}))

describe('CreateAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutationMock.isPending = false
  })

  it('submits agent app fields and default icon fields when creating an agent', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.createAgent/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.createDialog.title' })
    await user.type(within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }), ' Research Agent ')
    await user.type(within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.roleLabel' }), ' Research Assistant ')
    await user.type(within(dialog).getByPlaceholderText('agentV2.roster.createForm.descriptionPlaceholder'), ' Find and summarize market materials. ')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith({
      body: {
        name: 'Research Agent',
        description: 'Find and summarize market materials.',
        role: 'Research Assistant',
        icon_type: 'emoji',
        icon: '🧸',
        icon_background: '#F5F3FF',
      },
    }, expect.objectContaining({
      onError: expect.any(Function),
      onSuccess: expect.any(Function),
    }))
  })
})
