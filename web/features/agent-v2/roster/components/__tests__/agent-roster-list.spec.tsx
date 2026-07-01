import type { ComponentProps } from 'react'
import type { AgentRosterListItem } from '../agent-roster-list'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentRosterList } from '../agent-roster-list'

const { duplicateAgentMutationFn } = vi.hoisted(() => ({
  duplicateAgentMutationFn: vi.fn(),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '06/12/2026 12:00:00 PM',
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        get: {
          queryKey: ({ input }: { input: { params: { agent_id: string } } }) => ['agent-detail', input.params.agent_id],
        },
        copy: {
          post: {
            mutationOptions: () => ({
              mutationFn: duplicateAgentMutationFn,
            }),
          },
        },
        delete: {
          mutationOptions: () => ({
            mutationFn: vi.fn(),
          }),
        },
        put: {
          mutationOptions: () => ({
            mutationFn: vi.fn(),
          }),
        },
      },
    },
  },
}))

const createAgent = (overrides: Partial<AgentRosterListItem> = {}): AgentRosterListItem => ({
  active_config_is_published: false,
  description: 'Find and summarize market materials.',
  id: 'agent-1',
  icon: '🧸',
  icon_background: '#F5F3FF',
  icon_type: 'emoji',
  icon_url: null,
  mode: 'agent',
  name: 'Research Agent',
  published_reference_count: 0,
  published_references: [],
  role: 'Research Assistant',
  ...overrides,
})

const renderList = (
  agents: AgentRosterListItem[],
  overrides: Partial<ComponentProps<typeof AgentRosterList>> = {},
) => {
  const queryClient = new QueryClient()

  const result = render(
    <QueryClientProvider client={queryClient}>
      <AgentRosterList
        agents={agents}
        hasMore={false}
        isEmptySearch={false}
        isError={false}
        isFetching={false}
        isFetchingNextPage={false}
        isPending={false}
        label="Agent roster list"
        onLoadMore={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  )

  return {
    ...result,
    queryClient,
  }
}

describe('AgentRosterList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(toast, 'error').mockReturnValue('toast-id')
    vi.spyOn(toast, 'success').mockReturnValue('toast-id')
    duplicateAgentMutationFn.mockResolvedValue(createAgent({
      id: 'agent-copy',
      name: 'Research Agent copy',
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders role under the card title instead of the agent mode', () => {
    renderList([createAgent()])

    expect(screen.getByText('Research Assistant')).toBeInTheDocument()
    expect(screen.queryByText('agent')).not.toBeInTheDocument()
  })

  it('uses the Figma-aligned card title and role typography', () => {
    renderList([createAgent()])

    expect(screen.getByRole('heading', { name: 'Research Agent' })).toHaveClass('system-md-semibold')
    expect(screen.getByText('Research Assistant')).toHaveClass('system-xs-regular')
    expect(screen.getByText('agentV2.roster.usageStatus.draft')).toHaveClass('system-2xs-medium-uppercase')
  })

  it('draws the primary link focus ring above the draft corner label without z-index', () => {
    renderList([createAgent()])

    const configureLink = screen.getByRole('link', { name: 'Research Agent' })
    const draftLabel = screen.getByText('agentV2.roster.usageStatus.draft')
    const draftCornerLabel = draftLabel.closest('.absolute')

    expect(configureLink).toHaveClass(
      'relative',
      'focus-visible:after:ring-2',
      'focus-visible:after:ring-state-accent-solid',
      'focus-visible:after:ring-inset',
    )
    expect(configureLink).not.toHaveClass('peer/card-link')
    expect(draftCornerLabel && configureLink.contains(draftCornerLabel)).toBe(true)
    expect(draftCornerLabel).toHaveClass(
      'top-[-0.5px]',
      'right-0',
    )
    expect(draftCornerLabel).not.toHaveClass('z-10', 'z-20')
  })

  it('only renders the draft badge for unpublished agents', () => {
    renderList([
      createAgent({
        active_config_is_published: true,
        id: 'agent-published',
        name: 'Published Agent',
        published_reference_count: 1,
      }),
      createAgent({
        id: 'agent-draft',
        name: 'Draft Agent',
        published_reference_count: 0,
      }),
    ])

    expect(screen.getByText('agentV2.roster.usageStatus.draft')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Published Agent' })).toBeInTheDocument()
    expect(screen.queryByText('agentV2.roster.usageStatus.inUse')).not.toBeInTheDocument()
    expect(screen.queryByText('agentV2.roster.status.active')).not.toBeInTheDocument()
  })

  it('renders the Figma-aligned empty roster overlay', () => {
    const { container } = renderList([])

    expect(screen.getByRole('heading', { name: 'agentV2.roster.empty' })).toHaveClass('system-sm-regular', 'text-text-tertiary')
    expect(container.querySelectorAll('.bg-background-default-lighter')).toHaveLength(16)
    expect(container.querySelector('.bg-linear-to-b')).toBeInTheDocument()
    expect(container.querySelector('.i-ri-robot-2-line')).toHaveClass('size-6', 'text-text-tertiary')
  })

  it('uses the same overlay treatment for empty search results', () => {
    const { container } = renderList([], { isEmptySearch: true })

    expect(screen.getByRole('heading', { name: 'agentV2.roster.emptySearch' })).toBeInTheDocument()
    expect(container.querySelectorAll('.bg-background-default-lighter')).toHaveLength(16)
    expect(screen.queryByText('agentV2.roster.emptySearchDescription')).not.toBeInTheDocument()
  })

  it('uses the same overlay treatment for loading errors', () => {
    const { container } = renderList([], { isError: true })

    expect(screen.getByRole('heading', { name: 'agentV2.roster.loadingError' })).toHaveClass('system-sm-regular', 'text-text-tertiary')
    expect(container.querySelectorAll('.bg-background-default-lighter')).toHaveLength(16)
    expect(container.querySelector('.bg-linear-to-b')).toBeInTheDocument()
  })

  it('opens published workflow references from the card reference trigger', async () => {
    const user = userEvent.setup()
    renderList([
      createAgent({
        published_reference_count: 1,
        published_references: [
          {
            app_id: 'workflow-app-id',
            app_icon: '🐍',
            app_icon_background: '#E9F8D8',
            app_icon_type: 'emoji',
            app_name: 'RFP Review Flow',
          },
        ],
      }),
    ])

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.references\.trigger/ }))

    const workflowLink = screen.getByRole('menuitem', { name: /RFP Review Flow/ })
    expect(workflowLink).toHaveAttribute('href', '/app/workflow-app-id/workflow')
    expect(workflowLink).toHaveAttribute('target', '_blank')
    expect(workflowLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText(/agentV2\.roster\.references\.label/)).toBeInTheDocument()
  })

  it('opens a duplicate dialog from the card action menu', async () => {
    const user = userEvent.setup()
    renderList([createAgent()])

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: /common\.operation\.duplicate/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.duplicateDialog.title' })
    expect(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.nameLabel/ })).toHaveValue('')
    expect(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.nameLabel/ })).toHaveAttribute('placeholder', 'Research Agent copy')
    expect(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.roleLabel/ })).toHaveValue('Research Assistant')
    expect(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.descriptionLabel/ })).toHaveValue('Find and summarize market materials.')
    expect(duplicateAgentMutationFn).not.toHaveBeenCalled()
  })

  it('uses the latest cached agent detail when opening the duplicate dialog', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderList([
      createAgent({
        description: null,
      }),
    ])
    queryClient.setQueryData(['agent-detail', 'agent-1'], createAgent({
      description: 'Summarize new market updates.',
      role: 'Market Researcher',
    }))

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: /common\.operation\.duplicate/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.duplicateDialog.title' })
    expect(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.nameLabel/ })).toHaveValue('')
    expect(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.nameLabel/ })).toHaveAttribute('placeholder', 'Research Agent copy')
    expect(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.descriptionLabel/ })).toHaveValue('Summarize new market updates.')
    expect(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.roleLabel/ })).toHaveValue('Market Researcher')
  })

  it('duplicates an agent with backend-generated naming when the dialog name is empty', async () => {
    const user = userEvent.setup()
    renderList([createAgent()])

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: /common\.operation\.duplicate/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.duplicateDialog.title' })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.duplicate' }))

    expect(duplicateAgentMutationFn).toHaveBeenCalledWith(
      {
        params: {
          agent_id: 'agent-1',
        },
        body: {
          description: 'Find and summarize market materials.',
          role: 'Research Assistant',
          icon: '🧸',
          icon_background: '#F5F3FF',
          icon_type: 'emoji',
        },
      },
      expect.objectContaining({
        client: expect.any(QueryClient),
      }),
    )
    expect(duplicateAgentMutationFn.mock.calls[0]?.[0].body).not.toHaveProperty('name')
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('agentV2.roster.duplicateSuccess')
    })
  })

  it('duplicates an agent with the dialog name, role, and description when provided', async () => {
    const user = userEvent.setup()
    renderList([createAgent()])

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: /common\.operation\.duplicate/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.duplicateDialog.title' })
    const nameInput = within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.nameLabel/ })
    const roleInput = within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.roleLabel/ })
    const descriptionInput = within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.descriptionLabel/ })
    await user.clear(nameInput)
    await user.type(nameInput, ' Market Agent ')
    await user.clear(roleInput)
    await user.type(roleInput, ' Market Analyst ')
    await user.clear(descriptionInput)
    await user.type(descriptionInput, ' Copied for market research ')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.duplicate' }))

    expect(duplicateAgentMutationFn).toHaveBeenCalledWith(
      {
        params: {
          agent_id: 'agent-1',
        },
        body: {
          name: 'Market Agent',
          description: 'Copied for market research',
          role: 'Market Analyst',
          icon: '🧸',
          icon_background: '#F5F3FF',
          icon_type: 'emoji',
        },
      },
      expect.objectContaining({
        client: expect.any(QueryClient),
      }),
    )
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('agentV2.roster.duplicateSuccess')
    })
  })

  it('shows a field error when duplicating with an empty role', async () => {
    const user = userEvent.setup()
    renderList([createAgent()])

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: /common\.operation\.duplicate/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.duplicateDialog.title' })
    await user.clear(within(dialog).getByRole('textbox', { name: /agentV2\.roster\.createForm\.roleLabel/ }))
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.duplicate' }))

    expect(await within(dialog).findByText('agentV2.roster.createForm.roleRequired')).toBeInTheDocument()
    expect(duplicateAgentMutationFn).not.toHaveBeenCalled()
  })

  it('resets the edit form draft when reopening after canceling unsaved changes', async () => {
    const user = userEvent.setup()
    renderList([createAgent()])

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: /agentV2\.roster\.editInfo/ }))

    const dialog = await screen.findByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    const nameInput = within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Draft Name')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'agentV2.roster.editDialog.title' })).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /agentV2\.roster\.moreActions/ }))
    await user.click(screen.getByRole('menuitem', { name: /agentV2\.roster\.editInfo/ }))

    const reopenedDialog = await screen.findByRole('dialog', { name: 'agentV2.roster.editDialog.title' })
    expect(within(reopenedDialog).getByRole('textbox', { name: 'agentV2.roster.createForm.nameLabel' })).toHaveValue('Research Agent')
    expect(within(reopenedDialog).getByRole('textbox', { name: 'agentV2.roster.createForm.roleLabel' })).toHaveValue('Research Assistant')
    expect(within(reopenedDialog).getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
  })
})
