import type { useCreateInlineAgentBinding } from '../nodes/agent-v2/hooks'
import type { Node } from '../types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useNodes } from 'reactflow'
import CandidateNodeMain from '../candidate-node-main'
import { CUSTOM_NODE } from '../constants'
import { CUSTOM_NOTE_NODE } from '../note-node/constants'
import { useStore } from '../store'
import { BlockEnum } from '../types'
import { createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

const mocks = vi.hoisted(() => ({
  selectNode: vi.fn(),
  saveHistory: vi.fn(),
  syncDraft: vi.fn(),
  webhook: vi.fn(),
  createBinding: vi.fn(),
}))
vi.mock('../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({ handleNodeSelect: mocks.selectNode }),
}))
vi.mock('../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: mocks.syncDraft }),
}))
vi.mock('../hooks/use-auto-generate-webhook-url', () => ({
  useAutoGenerateWebhookUrl: () => mocks.webhook,
}))
vi.mock('../hooks/use-workflow-history', () => ({
  useWorkflowHistory: () => ({ saveStateToHistory: mocks.saveHistory }),
  WorkflowHistoryEvent: { NodeAdd: 'NodeAdd', NoteAdd: 'NoteAdd' },
}))
vi.mock('@/app/components/workflow/nodes', () => ({
  default: ({ id }: { id: string }) => <div>{id}</div>,
}))
vi.mock('@/app/components/workflow/note-node', () => ({
  default: ({ id }: { id: string }) => <div>{id}</div>,
}))
vi.mock('@/app/components/workflow/nodes/agent-v2/hooks', () => ({
  useCreateInlineAgentBinding: () => ({ createInlineAgentBinding: mocks.createBinding }),
}))

let nodes: Node[] = []
const CandidateHarness = () => {
  nodes = useNodes() as Node[]
  const candidate = useStore((state) => state.candidateNode)
  return candidate ? <CandidateNodeMain candidateNode={candidate} /> : null
}
const renderCandidate = (candidateNode: Node) =>
  renderWorkflowFlowComponent(<CandidateHarness />, {
    nodes: [createNode({ id: 'existing-node' })],
    initialStoreState: {
      candidateNode,
      mousePosition: { pageX: 100, pageY: 200, elementX: 30, elementY: 40 },
    },
    reactFlowProps: { fitView: false, defaultViewport: { x: 0, y: 0, zoom: 1 } },
    hooksStoreProps: {
      accessControl: {
        canEdit: true,
        canRun: true,
        canImportExportDSL: true,
        canReleaseAndVersion: true,
      },
    },
  })
const candidate = (type: BlockEnum, id = 'candidate') =>
  createNode({
    id,
    type: CUSTOM_NODE,
    data: { type, title: 'Candidate', _isCandidate: true },
  })
const inlineCandidate = () =>
  createNode({
    id: 'inline-agent',
    type: CUSTOM_NODE,
    data: {
      type: BlockEnum.Agent,
      title: 'Inline agent',
      version: '2',
      agent_node_kind: 'dify_agent',
      agent_binding: { binding_type: 'inline_agent' },
      _isCandidate: true,
    },
  })
type BindingOptions = NonNullable<
  Parameters<ReturnType<typeof useCreateInlineAgentBinding>['createInlineAgentBinding']>[1]
>

beforeEach(() => {
  vi.resetAllMocks()
  nodes = []
})

describe('CandidateNodeMain', () => {
  it('places a webhook once and waits for draft sync before generating its URL', async () => {
    let synced!: () => void
    mocks.syncDraft.mockImplementation((_sync, _force, options) => {
      synced = options.onSuccess
    })
    const { store } = renderCandidate(candidate(BlockEnum.TriggerWebhook, 'webhook'))
    expect(screen.getByText('webhook')).toBeInTheDocument()
    fireEvent.click(window)
    await waitFor(() => expect(store.getState().candidateNode).toBeUndefined())
    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'existing-node' }),
        expect.objectContaining({
          id: 'webhook',
          position: { x: 100, y: 200 },
          data: expect.objectContaining({ _isCandidate: false }),
        }),
      ]),
    )
    expect(mocks.saveHistory).toHaveBeenCalledWith('NodeAdd', { nodeId: 'webhook' })
    expect(mocks.webhook).not.toHaveBeenCalled()
    act(() => synced())
    expect(mocks.webhook).toHaveBeenCalledWith('webhook')
    fireEvent.click(window)
    expect(nodes.map((node) => node.id)).toEqual(['existing-node', 'webhook'])
  })

  it('records note history and selects the inserted note', () => {
    renderCandidate({ ...candidate(BlockEnum.Code, 'note'), type: CUSTOM_NOTE_NODE })
    fireEvent.click(window)
    expect(nodes.map((node) => node.id)).toEqual(['existing-node', 'note'])
    expect(mocks.saveHistory).toHaveBeenCalledWith('NoteAdd', { nodeId: 'note' })
    expect(mocks.selectNode).toHaveBeenCalledWith('note')
  })

  it('preserves a roster binding and syncs the new agent without creating an inline binding', () => {
    const node = inlineCandidate()
    renderCandidate({
      ...node,
      data: Object.assign({}, node.data, {
        agent_binding: { binding_type: 'roster_agent', agent_id: 'agent-1' },
      }),
    })
    fireEvent.click(window)
    expect(nodes.find((node) => node.id === 'inline-agent')?.data).toMatchObject({
      agent_binding: { binding_type: 'roster_agent', agent_id: 'agent-1' },
      _isCandidate: false,
    })
    expect(mocks.syncDraft).toHaveBeenCalledWith(true, true)
    expect(mocks.createBinding).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'] as const)(
    'settles a temporary inline agent after binding %s',
    async (outcome) => {
      let callbacks!: BindingOptions
      mocks.createBinding.mockImplementation((_id, options) => {
        callbacks = options
      })
      const { store } = renderCandidate(inlineCandidate())
      fireEvent.click(window)
      expect(mocks.createBinding).toHaveBeenCalledWith('inline-agent', expect.anything())
      expect(nodes.find((node) => node.id === 'inline-agent')?.data).toMatchObject({
        _isTempNode: true,
        selected: true,
      })
      expect(store.getState().openInlineAgentPanelNodeId).toBe('inline-agent')
      act(() => {
        if (outcome === 'success')
          callbacks.onSuccess?.({
            binding_type: 'inline_agent',
            agent_id: 'bound-agent',
            current_snapshot_id: 'snapshot',
          })
        else callbacks.onError?.()
      })
      if (outcome === 'success') {
        const added = nodes.find((node) => node.id === 'inline-agent')
        expect(added?.data).toMatchObject({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'bound-agent',
            current_snapshot_id: 'snapshot',
          },
        })
        expect(added?.data._isTempNode).toBeUndefined()
        expect(mocks.syncDraft).toHaveBeenCalledTimes(2)
      } else {
        await waitFor(() => expect(nodes.map((node) => node.id)).toEqual(['existing-node']))
      }
    },
  )

  it.each([
    [BlockEnum.Iteration, BlockEnum.IterationStart, 'isInIteration'],
    [BlockEnum.Loop, BlockEnum.LoopStart, 'isInLoop'],
  ] as const)('adds a %s and its required start node', (type, startType, flag) => {
    renderCandidate(candidate(type))
    fireEvent.click(window)
    expect(nodes).toHaveLength(3)
    expect(nodes).toContainEqual(
      expect.objectContaining({
        parentId: 'candidate',
        data: expect.objectContaining({ type: startType, [flag]: true }),
      }),
    )
  })

  it('cancels placement without changing the graph or saving history', () => {
    const { store } = renderCandidate(candidate(BlockEnum.Code))
    fireEvent.contextMenu(window)
    expect(store.getState().candidateNode).toBeUndefined()
    expect(nodes.map((node) => node.id)).toEqual(['existing-node'])
    expect(mocks.saveHistory).not.toHaveBeenCalled()
  })
})
