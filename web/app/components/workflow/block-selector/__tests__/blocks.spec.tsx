import type { NodeDefault } from '../../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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
  inviteOptionsQueryFn: vi.fn(),
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

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agents: {
      inviteOptions: {
        get: {
          queryOptions: (options: unknown) => ({
            queryKey: ['agents', 'invite-options', options],
            queryFn: () => queryMocks.inviteOptionsQueryFn(options),
          }),
        },
      },
    },
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
    queryMocks.inviteOptionsQueryFn.mockResolvedValue({
      data: [],
      has_more: false,
      limit: 8,
      page: 1,
      total: 0,
    })
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
            availableBlocksTypes={[BlockEnum.Agent]}
            blocks={[createBlock(BlockEnum.Agent, 'Agent')]}
          />
        </HooksStoreContext>
      </QueryClientProvider>,
    )

    await user.hover(screen.getByRole('button', { name: 'Agent' }))

    expect(await screen.findByRole('dialog', { name: 'agentV2.roster.nodeSelector.dialogLabel' })).toBeInTheDocument()
  })

  it('opens the agent selector from the Agent block and selects an agent', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    queryMocks.inviteOptionsQueryFn.mockResolvedValue({
      data: [
        {
          id: 'agent-1',
          name: 'Nadia',
          description: 'Clarification Drafter',
          agent_kind: 'dify_agent',
          icon: 'A',
          icon_background: '#E9D7FE',
          icon_type: 'emoji',
          scope: 'roster',
          source: 'workflow',
          status: 'active',
        },
      ],
      has_more: false,
      limit: 8,
      page: 1,
      total: 1,
    })

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
            availableBlocksTypes={[BlockEnum.LLM, BlockEnum.Agent]}
            blocks={[
              createBlock(BlockEnum.LLM, 'LLM', BlockClassificationEnum.Default, 0),
              createBlock(BlockEnum.Agent, 'Agent', BlockClassificationEnum.Default, 3),
            ]}
          />
        </HooksStoreContext>
      </QueryClientProvider>,
    )

    expect(
      screen.getByText('Agent').compareDocumentPosition(screen.getByText('LLM')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Agent' }))

    expect(await screen.findByRole('dialog', { name: 'agentV2.roster.nodeSelector.dialogLabel' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'agentV2.roster.searchLabel' })).toBeInTheDocument()
    expect(await screen.findByText('Nadia')).toBeInTheDocument()
    expect(screen.getByText('Clarification Drafter')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Nadia Clarification Drafter' }))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.Agent)
    expect(queryMocks.inviteOptionsQueryFn).toHaveBeenCalledWith({
      input: {
        query: {
          app_id: 'app-1',
          limit: 8,
          page: 1,
        },
      },
    })
  })
})
