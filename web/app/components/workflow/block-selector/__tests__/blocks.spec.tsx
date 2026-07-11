import type {
  AgentInviteOptionResponse,
  AgentInviteOptionsResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { NodeDefault } from '../../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FlowType } from '@/types/common'
import { HooksStoreContext } from '../../hooks-store/provider'
import { createHooksStore } from '../../hooks-store/store'
import { BlockEnum } from '../../types'
import Blocks from '../blocks'
import { BlockClassificationEnum } from '../types'

const runtimeState = vi.hoisted(() => ({
  appType: 'workflow' as string | undefined,
  nodes: [] as Array<{ data: { type?: BlockEnum } }>,
}))

const queryMocks = vi.hoisted(() => ({
  request: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => runtimeState.nodes,
    }),
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: { type?: string } }) => unknown) => selector({
    appDetail: {
      type: runtimeState.appType,
    },
  }),
}))

vi.mock('@/service/base', () => ({
  request: (...args: unknown[]) => queryMocks.request(...args),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (message: string) => queryMocks.toastError(message),
  },
}))

const createBlock = (
  type: BlockEnum,
  title: string,
  classification = BlockClassificationEnum.Default,
  sort = 0,
): NodeDefault => ({
  metaData: {
    classification,
    sort,
    type,
    title,
    author: 'Dify',
    description: `${title} description`,
  },
  defaultValue: {},
  checkValid: () => ({ isValid: true }),
})

const createInviteOption = (
  overrides: Partial<AgentInviteOptionResponse> & Pick<AgentInviteOptionResponse, 'id' | 'name'>,
): AgentInviteOptionResponse => {
  const { id, name, ...rest } = overrides

  return {
    id,
    name,
    description: rest.description ?? 'Clarification Drafter',
    active_config_snapshot_id: rest.active_config_snapshot_id ?? 'version-1',
    role: rest.role ?? 'Researcher',
    agent_kind: rest.agent_kind ?? 'dify_agent',
    icon: rest.icon ?? 'A',
    icon_background: rest.icon_background ?? '#E9D7FE',
    icon_type: rest.icon_type ?? 'emoji',
    scope: rest.scope ?? 'roster',
    source: rest.source ?? 'workflow',
    status: rest.status ?? 'active',
    ...rest,
  }
}

const createInviteOptionsResponse = (
  agents: AgentInviteOptionResponse[],
): AgentInviteOptionsResponse => ({
  data: agents,
  has_more: false,
  limit: 8,
  page: 1,
  total: agents.length,
})

const createJsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })

const mockInviteOptionsResponse = (agents: AgentInviteOptionResponse[]) => {
  queryMocks.request.mockImplementation(() => Promise.resolve(createJsonResponse(createInviteOptionsResponse(agents))))
}

const expectLastInviteOptionsRequest = () => {
  const [url] = queryMocks.request.mock.calls.at(-1) ?? []
  const requestURL = new URL(String(url), window.location.origin)

  expect(requestURL.pathname).toBe('/console/api/agent/invite-options')
  return requestURL
}

describe('Blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeState.appType = 'workflow'
    runtimeState.nodes = []
  })

  it('should render grouped blocks, filter duplicate knowledge-base nodes, and select a block', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    runtimeState.nodes = [{ data: { type: BlockEnum.KnowledgeBase } }]

    render(
      <Blocks
        searchText=""
        onSelect={onSelect}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.LoopEnd, BlockEnum.KnowledgeBase]}
        blocks={[
          createBlock(BlockEnum.LLM, 'LLM'),
          createBlock(BlockEnum.LoopEnd, 'Exit Loop', BlockClassificationEnum.Logic),
          createBlock(BlockEnum.KnowledgeBase, 'Knowledge Retrieval'),
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: 'LLM' })).toBeInTheDocument()
    expect(screen.getByText('Exit Loop')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.loop.loopNode')).toBeInTheDocument()
    expect(screen.queryByText('Knowledge Retrieval')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'LLM' }))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.LLM)
  })

  it('should show the empty state when no block matches the search text', () => {
    render(
      <Blocks
        searchText="missing"
        onSelect={vi.fn()}
        availableBlocksTypes={[BlockEnum.LLM]}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
      />,
    )

    expect(screen.getByText('workflow.tabs.noResult')).toBeInTheDocument()
  })

  it('opens the agent selector on Agent block hover', async () => {
    const user = userEvent.setup()
    mockInviteOptionsResponse([])
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    const hooksStore = createHooksStore({
      configsMap: {
        flowId: 'app-1',
        flowType: FlowType.appFlow,
        fileSettings: {} as never,
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <HooksStoreContext value={hooksStore}>
          <Blocks
            searchText=""
            onSelect={vi.fn()}
            availableBlocksTypes={[BlockEnum.AgentV2]}
            blocks={[createBlock(BlockEnum.AgentV2, 'Agent')]}
          />
        </HooksStoreContext>
      </QueryClientProvider>,
    )

    const agentBlock = screen.getByRole('button', { name: /Agent/ })
    expect(agentBlock).toHaveTextContent('common.menus.status')

    await user.hover(agentBlock)

    expect(await screen.findByRole('dialog', { name: 'agentV2.roster.nodeSelector.dialogLabel' })).toBeInTheDocument()
  })

  it('opens the agent selector from the Agent block and selects an agent', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mockInviteOptionsResponse([
      createInviteOption({
        id: 'agent-1',
        name: 'Nadia',
      }),
    ])

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    const hooksStore = createHooksStore({
      configsMap: {
        flowId: 'app-1',
        flowType: FlowType.appFlow,
        fileSettings: {} as never,
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <HooksStoreContext value={hooksStore}>
          <Blocks
            searchText=""
            onSelect={onSelect}
            availableBlocksTypes={[BlockEnum.LLM, BlockEnum.AgentV2]}
            blocks={[
              createBlock(BlockEnum.LLM, 'LLM', BlockClassificationEnum.Default, 0),
              createBlock(BlockEnum.AgentV2, 'Agent', BlockClassificationEnum.Default, 3),
            ]}
          />
        </HooksStoreContext>
      </QueryClientProvider>,
    )

    expect(
      screen.getByText('Agent').compareDocumentPosition(screen.getByText('LLM')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Agent/ }))

    expect(await screen.findByRole('dialog', { name: 'agentV2.roster.nodeSelector.dialogLabel' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'agentV2.roster.searchLabel' })).toBeInTheDocument()
    expect(await screen.findByText('Nadia')).toBeInTheDocument()
    expect(screen.getByText('Researcher')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Nadia Researcher' }))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.AgentV2, {
      agent_binding: {
        binding_type: 'roster_agent',
        agent_id: 'agent-1',
      },
      agent_node_kind: 'dify_agent',
      version: '2',
    })
    const requestURL = expectLastInviteOptionsRequest()
    expect(requestURL.searchParams.get('app_id')).toBe('app-1')
    expect(requestURL.searchParams.get('limit')).toBe('8')
    expect(requestURL.searchParams.get('page')).toBe('1')
  })

  it('should refresh Agent v2 roster options when the selector is reopened', async () => {
    const user = userEvent.setup()
    queryMocks.request
      .mockImplementationOnce(() => Promise.resolve(createJsonResponse(createInviteOptionsResponse([
        createInviteOption({
          id: 'agent-1',
          name: 'Nadia',
        }),
      ]))))
      .mockImplementation(() => Promise.resolve(createJsonResponse(createInviteOptionsResponse([
        createInviteOption({
          id: 'agent-2',
          name: 'Bruno',
          role: 'Planner',
        }),
      ]))))
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 5 * 60 * 1000,
        },
      },
    })
    const hooksStore = createHooksStore({
      configsMap: {
        flowId: 'app-1',
        flowType: FlowType.appFlow,
        fileSettings: {} as never,
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <HooksStoreContext value={hooksStore}>
          <Blocks
            searchText=""
            onSelect={vi.fn()}
            availableBlocksTypes={[BlockEnum.AgentV2]}
            blocks={[createBlock(BlockEnum.AgentV2, 'Agent', BlockClassificationEnum.Default, 3)]}
          />
        </HooksStoreContext>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: /Agent/ }))
    expect(await screen.findByText('Nadia')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'agentV2.roster.searchLabel' }))
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'agentV2.roster.nodeSelector.dialogLabel' })).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Agent/ }))

    expect(await screen.findByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText('Planner')).toBeInTheDocument()
    await waitFor(() => expect(queryMocks.request).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Nadia')).not.toBeInTheDocument()
  })

  it('does not select an Agent v2 roster agent without active config snapshot', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mockInviteOptionsResponse([
      createInviteOption({
        id: 'agent-1',
        name: 'Nadia',
        active_config_snapshot_id: null,
      }),
    ])

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    const hooksStore = createHooksStore({
      configsMap: {
        flowId: 'app-1',
        flowType: FlowType.appFlow,
        fileSettings: {} as never,
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <HooksStoreContext value={hooksStore}>
          <Blocks
            searchText=""
            onSelect={onSelect}
            availableBlocksTypes={[BlockEnum.AgentV2]}
            blocks={[createBlock(BlockEnum.AgentV2, 'Agent', BlockClassificationEnum.Default, 3)]}
          />
        </HooksStoreContext>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: /Agent/ }))
    expect(await screen.findByText('Nadia')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Nadia Researcher' }))

    await waitFor(() => expect(queryMocks.toastError).toHaveBeenCalledWith('workflow.nodes.agent.modelNotSelected'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('inserts an inline Agent v2 node from the selector start action', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mockInviteOptionsResponse([])
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    const hooksStore = createHooksStore({
      configsMap: {
        flowId: 'app-1',
        flowType: FlowType.appFlow,
        fileSettings: {} as never,
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <HooksStoreContext value={hooksStore}>
          <Blocks
            searchText=""
            onSelect={onSelect}
            availableBlocksTypes={[BlockEnum.AgentV2]}
            blocks={[createBlock(BlockEnum.AgentV2, 'Agent', BlockClassificationEnum.Default, 3)]}
          />
        </HooksStoreContext>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: /Agent/ }))
    const consoleLink = await screen.findByRole('option', { name: 'agentV2.roster.nodeSelector.manageInAgentConsole' })
    expect(consoleLink).toHaveAttribute('href', '/agents')
    expect(consoleLink).toHaveAttribute('target', '_blank')
    expect(consoleLink).toHaveAttribute('rel', 'noopener noreferrer')
    await user.click(await screen.findByRole('option', { name: 'agentV2.roster.nodeSelector.startFromScratch' }))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.AgentV2, {
      agent_binding: {
        binding_type: 'inline_agent',
      },
      agent_node_kind: 'dify_agent',
      version: '2',
    })
  })

  it('closes the agent selector when Escape closes the combobox', async () => {
    const user = userEvent.setup()
    mockInviteOptionsResponse([])
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    const hooksStore = createHooksStore({
      configsMap: {
        flowId: 'app-1',
        flowType: FlowType.appFlow,
        fileSettings: {} as never,
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <HooksStoreContext value={hooksStore}>
          <Blocks
            searchText=""
            onSelect={vi.fn()}
            availableBlocksTypes={[BlockEnum.AgentV2]}
            blocks={[createBlock(BlockEnum.AgentV2, 'Agent')]}
          />
        </HooksStoreContext>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: /Agent/ }))

    expect(await screen.findByRole('dialog', { name: 'agentV2.roster.nodeSelector.dialogLabel' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'agentV2.roster.searchLabel' }))
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'agentV2.roster.nodeSelector.dialogLabel' })).not.toBeInTheDocument()
    })
  })
})
