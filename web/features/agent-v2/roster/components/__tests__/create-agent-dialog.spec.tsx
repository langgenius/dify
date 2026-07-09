import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateAgentDialog } from '../create-agent-dialog'

const mutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

const routerPushMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    isPending: mutationMock.isPending,
    mutate: mutationMock.mutate,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
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
    await user.type(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.roleLabel/ }), ' Research Assistant ')
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
      onSuccess: expect.any(Function),
    }))
    const mutationOptions = mutationMock.mutate.mock.calls[0]?.[1]
    expect(mutationOptions).not.toHaveProperty('onError')
  })

  it('navigates to the new agent configure page after creating an agent', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.createAgent/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.createDialog.title' })
    await user.type(within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }), 'Research Agent')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    const mutationOptions = mutationMock.mutate.mock.calls[0]?.[1]
    await act(async () => {
      mutationOptions.onSuccess({ id: 'agent-1' })
    })

    expect(toastMock.success).toHaveBeenCalledWith('agentV2.roster.createSuccess')
    expect(routerPushMock).toHaveBeenCalledWith('/agents/agent-1/configure')
  })

  it('shows a field error when creating with an empty name', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.createAgent/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.createDialog.title' })
    await user.type(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.roleLabel/ }), 'Research Assistant')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(await within(dialog).findByText('agentV2.roster.createForm.nameRequired')).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(mutationMock.mutate).not.toHaveBeenCalled()
  })

  it('marks role and description as optional', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.createAgent/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.createDialog.title' })

    expect(within(dialog).getByRole('textbox', {
      name: /agentV2\.roster\.createForm\.roleLabel.*common\.label\.optional/,
    })).not.toBeRequired()
    expect(within(dialog).getByRole('textbox', {
      name: /agentV2\.roster\.createForm\.descriptionLabel.*common\.label\.optional/,
    })).not.toBeRequired()
  })

  it('submits an empty role when role is left blank', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.createAgent/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.createDialog.title' })
    await user.type(within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' }), 'Research Agent')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith({
      body: {
        name: 'Research Agent',
        description: '',
        role: '',
        icon_type: 'emoji',
        icon: '🧸',
        icon_background: '#F5F3FF',
      },
    }, expect.objectContaining({
      onSuccess: expect.any(Function),
    }))
  })

  it('keeps the form open when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    render(<CreateAgentDialog />)

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.createAgent/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.createDialog.title' })
    const backdrop = document.body.querySelector('.bg-background-overlay') as HTMLElement
    await user.click(backdrop)

    expect(dialog).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'agentV2.roster.createDialog.title' })).not.toBeInTheDocument()
    })
  })
})
