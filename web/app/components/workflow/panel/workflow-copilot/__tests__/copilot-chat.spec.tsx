import type { CommonNodeType, Edge, Node } from '../../../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CopilotChat from '../copilot-chat'

const mocks = vi.hoisted(() => ({
  addContextNode: vi.fn(),
  clearContextNodes: vi.fn(),
  deleteConversation: vi.fn(),
  fetchMessages: vi.fn(),
  generate: vi.fn(),
  getState: vi.fn(),
  handleNodeSelect: vi.fn(),
  handleSyncDraft: vi.fn(),
  handleUpdateCanvas: vi.fn(),
  listConversations: vi.fn(),
  liveNodes: [] as Node<CommonNodeType>[],
  pinnedNodes: [] as { id: string; title: string }[],
  removeContextNode: vi.fn(),
}))

vi.mock('../service', () => ({
  deleteCopilotConversation: (...args: unknown[]) => mocks.deleteConversation(...args),
  fetchCopilotMessages: (...args: unknown[]) => mocks.fetchMessages(...args),
  generateWorkflowCopilot: (...args: unknown[]) => mocks.generate(...args),
  listCopilotConversations: (...args: unknown[]) => mocks.listConversations(...args),
}))

// MentionInput owns its rich contentEditable behavior in a separate focused
// suite. Here a semantic textarea keeps this feature test focused on the chat
// owner's request-building and Stop behavior.
vi.mock('../mention-input', () => ({
  default: ({
    onChange,
    onEnter,
  }: {
    onChange: (text: string, mentionIds: string[]) => void
    onEnter: () => void
  }) => (
    <textarea
      aria-label="copilot input"
      onChange={(e) => onChange(e.currentTarget.value, [])}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter()
      }}
    />
  ),
}))

vi.mock('reactflow', () => ({
  useNodes: () => mocks.liveNodes,
  useReactFlow: () => ({ getViewport: () => ({ x: 0, y: 0, zoom: 1 }) }),
  useStoreApi: () => ({ getState: mocks.getState }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ appDetail: { id: 'app-1' } }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      addCopilotContextNode: mocks.addContextNode,
      clearCopilotContextNodes: mocks.clearContextNodes,
      copilotContextNodes: mocks.pinnedNodes,
      removeCopilotContextNode: mocks.removeContextNode,
    }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: {
      model: 'gpt-4o',
      provider: { provider: 'openai' },
    },
  }),
}))

vi.mock('../../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({ handleNodeSelect: mocks.handleNodeSelect }),
}))

vi.mock('../../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: mocks.handleSyncDraft }),
}))

vi.mock('../../../hooks/use-workflow', () => ({
  useIsChatMode: () => false,
  useNodesReadOnly: () => ({ getNodesReadOnly: () => false }),
}))

vi.mock('../../../hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({ handleUpdateWorkflowCanvas: mocks.handleUpdateCanvas }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: vi.fn() },
}))

const placeholderNode = {
  id: 'placeholder',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: { type: 'start-placeholder', title: 'Workflow start' },
} as Node<CommonNodeType>

const realNode = (id: string, type: string): Node<CommonNodeType> =>
  ({
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { type, title: id },
  }) as Node<CommonNodeType>

const setCanvas = (nodes: Node<CommonNodeType>[], edges: Edge[] = []) => {
  mocks.liveNodes = nodes
  mocks.getState.mockReturnValue({
    edges,
    getNodes: () => nodes,
    transform: [10, 20, 0.8],
  })
}

const generatedGraph = {
  nodes: [realNode('generated-start', 'start')],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

const submitInstruction = async (instruction = 'Build a workflow') => {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'copilot input' }), instruction)
  await user.click(screen.getByRole('button', { name: /workflowGenerator\.generate/i }))
  return user
}

describe('CopilotChat generation request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.liveNodes = []
    mocks.pinnedNodes = []
    mocks.listConversations.mockResolvedValue({ conversations: [] })
    mocks.fetchMessages.mockResolvedValue({ conversation_id: 'conv-1', messages: [] })
    mocks.generate.mockResolvedValue({
      conversation_id: 'conv-1',
      graph: generatedGraph,
      reply: 'Proposal ready',
    })
  })

  it('treats a lone start placeholder as an empty canvas', async () => {
    setCanvas([placeholderNode])
    render(<CopilotChat />)

    await submitInstruction()

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce())
    const [body] = mocks.generate.mock.calls[0]!
    expect(body).not.toHaveProperty('current_graph')
  })

  it('keeps real nodes and removes placeholder edges from current_graph', async () => {
    const start = realNode('start', 'start')
    const llm = realNode('llm', 'llm')
    const placeholderEdge = {
      id: 'placeholder-edge',
      source: 'placeholder',
      target: 'start',
    } as Edge
    const realEdge = { id: 'real-edge', source: 'start', target: 'llm' } as Edge
    setCanvas([placeholderNode, start, llm], [placeholderEdge, realEdge])
    render(<CopilotChat />)

    await submitInstruction()

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce())
    const [body] = mocks.generate.mock.calls[0]!
    expect(body.current_graph).toEqual({
      nodes: [start, llm],
      edges: [realEdge],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    })
  })

  it('applies a proposal and restores the pre-apply canvas on Undo', async () => {
    setCanvas([placeholderNode])
    render(<CopilotChat />)

    const user = await submitInstruction()
    await user.click(await screen.findByRole('button', { name: /workflowGenerator\.apply/i }))

    expect(mocks.handleUpdateCanvas).toHaveBeenNthCalledWith(1, generatedGraph)
    expect(mocks.handleSyncDraft).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole('button', { name: /workflowGenerator\.undo/i }))

    expect(mocks.handleUpdateCanvas).toHaveBeenNthCalledWith(2, {
      nodes: [placeholderNode],
      edges: [],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    })
  })

  it('retries a proposal with its original instruction', async () => {
    setCanvas([placeholderNode])
    render(<CopilotChat />)

    const user = await submitInstruction('Summarize a URL')
    await user.click(await screen.findByRole('button', { name: /workflowGenerator\.retry/i }))

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2))
    expect(mocks.generate.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        conversation_id: 'conv-1',
        message: 'Summarize a URL',
      }),
    )
  })

  it('aborts the in-flight generation when Stop is clicked', async () => {
    setCanvas([placeholderNode])
    let requestSignal: AbortSignal | undefined
    mocks.generate.mockImplementation(
      (_body: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          requestSignal = options.signal
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    render(<CopilotChat />)

    const user = await submitInstruction()
    await user.click(await screen.findByRole('button', { name: /workflowGenerator\.stop/i }))

    expect(requestSignal?.aborted).toBe(true)
    expect(await screen.findByText(/workflowGenerator\.stopped/i)).toBeInTheDocument()
  })
})
