import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectExternalAgentDialog } from '../connect-external-agent-dialog'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  discover: vi.fn(),
  onOpenChange: vi.fn(),
  routerPush: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      external: {
        discover: {
          post: {
            mutationOptions: () => ({ mutationFn: mocks.discover }),
          },
        },
        post: {
          mutationOptions: () => ({ mutationFn: mocks.create }),
        },
      },
      get: {
        key: () => ['agents'],
      },
      inviteOptions: {
        get: {
          key: () => ['agent-invite-options'],
        },
      },
    },
  },
}))

describe('ConnectExternalAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.discover.mockResolvedValue({
      agent_card: {
        capabilities: {
          extendedAgentCard: false,
          pushNotifications: false,
          streaming: true,
        },
        description: 'Local Codex bridge',
        name: 'Local Codex',
        skills: [
          {
            description: 'Works in the local repository',
            id: 'coding',
            name: 'Coding',
            tags: ['code'],
          },
        ],
        supportedInterfaces: [
          {
            protocolBinding: 'JSONRPC',
            protocolVersion: '0.3.0',
            url: 'http://host.docker.internal:8765',
          },
        ],
        version: '1.0.0',
      },
      description: 'Local Codex bridge',
      name: 'Local Codex',
      protocol_version: '0.3.0',
      reachable: true,
      remote_agent_id: 'local-codex',
    })
    mocks.create.mockResolvedValue({
      id: 'external-agent-1',
    })
  })

  it('discovers, reviews, and connects an A2A agent', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ConnectExternalAgentDialog open onOpenChange={mocks.onOpenChange} />
      </QueryClientProvider>,
    )

    const dialog = screen.getByRole('dialog', { name: 'agentV2.externalAgent.connectTitle' })
    const endpoint = within(dialog).getByRole('textbox', {
      name: 'agentV2.externalAgent.endpoint.label',
    })
    await user.type(endpoint, 'http://host.docker.internal:8765')
    await user.click(
      within(dialog).getByRole('button', { name: 'agentV2.externalAgent.checkConnection' }),
    )

    expect(mocks.discover).toHaveBeenCalledWith(
      {
        body: {
          auth_type: 'none',
          endpoint: 'http://host.docker.internal:8765',
        },
      },
      expect.objectContaining({ client: queryClient }),
    )
    expect(await within(dialog).findByRole('heading', { name: 'Local Codex' })).toBeInTheDocument()
    expect(within(dialog).getByText('agentV2.externalAgent.connectionVerified')).toBeInTheDocument()

    await user.type(
      within(dialog).getByRole('textbox', { name: 'agentV2.roster.createForm.roleLabel' }),
      'Coding Agent',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'agentV2.externalAgent.connectAction' }),
    )

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith(
        {
          body: {
            auth_type: 'none',
            description: 'Local Codex bridge',
            endpoint: 'http://host.docker.internal:8765',
            name: 'Local Codex',
            role: 'Coding Agent',
          },
        },
        expect.objectContaining({ client: queryClient }),
      )
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('agentV2.externalAgent.connectSuccess')
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.routerPush).toHaveBeenCalledWith('/agents/external-agent-1/configure')
  })
})
