import { render, screen } from '@testing-library/react'
import CandidateNodeMain from '../candidate-node-main'
import { CUSTOM_NODE } from '../constants'
import { CUSTOM_NOTE_NODE } from '../note-node/constants'
import { BlockEnum } from '../types'
import { createNode } from './fixtures'

const mockUseEventListener = vi.hoisted(() => vi.fn())
const mockUseStoreApi = vi.hoisted(() => vi.fn())
const mockUseReactFlow = vi.hoisted(() => vi.fn())
const mockUseViewport = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockUseWorkflowStore = vi.hoisted(() => vi.fn())
const mockUseHooks = vi.hoisted(() => vi.fn())
const mockCustomNode = vi.hoisted(() => vi.fn())
const mockCustomNoteNode = vi.hoisted(() => vi.fn())
const mockGetIterationStartNode = vi.hoisted(() => vi.fn())
const mockGetLoopStartNode = vi.hoisted(() => vi.fn())

vi.mock('ahooks', () => ({
  useEventListener: (...args: unknown[]) => mockUseEventListener(...args),
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => mockUseStoreApi(),
  useReactFlow: () => mockUseReactFlow(),
  useViewport: () => mockUseViewport(),
  Position: {
    Left: 'left',
    Right: 'right',
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { mousePosition: {
    pageX: number
    pageY: number
    elementX: number
    elementY: number
  } }) => unknown) => mockUseStore(selector),
  useWorkflowStore: () => mockUseWorkflowStore(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesInteractions: () => mockUseHooks().useNodesInteractions(),
  useNodesSyncDraft: () => mockUseHooks().useNodesSyncDraft(),
  useWorkflowHistory: () => mockUseHooks().useWorkflowHistory(),
  useAutoGenerateWebhookUrl: () => mockUseHooks().useAutoGenerateWebhookUrl(),
  WorkflowHistoryEvent: {
    NodeAdd: 'NodeAdd',
    NoteAdd: 'NoteAdd',
  },
}))

vi.mock('@/app/components/workflow/nodes', () => ({
  __esModule: true,
  default: (props: { id: string }) => {
    mockCustomNode(props)
    return <div data-testid="candidate-custom-node">{props.id}</div>
  },
}))

vi.mock('@/app/components/workflow/note-node', () => ({
  __esModule: true,
  default: (props: { id: string }) => {
    mockCustomNoteNode(props)
    return <div data-testid="candidate-note-node">{props.id}</div>
  },
}))

vi.mock('@/app/components/workflow/utils', () => ({
  getIterationStartNode: (...args: unknown[]) => mockGetIterationStartNode(...args),
  getLoopStartNode: (...args: unknown[]) => mockGetLoopStartNode(...args),
}))

describe('CandidateNodeMain', () => {
  const mockSetNodes = vi.fn()
  const mockHandleNodeSelect = vi.fn()
  const mockSaveStateToHistory = vi.fn()
  const mockHandleSyncWorkflowDraft = vi.fn()
  const mockAutoGenerateWebhookUrl = vi.fn()
  const mockWorkflowStoreSetState = vi.fn()
  const createNodesInteractions = () => ({
    handleNodeSelect: mockHandleNodeSelect,
  })
  const createWorkflowHistory = () => ({
    saveStateToHistory: mockSaveStateToHistory,
  })
  const createNodesSyncDraft = () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  })
  const createAutoGenerateWebhookUrl = () => mockAutoGenerateWebhookUrl
  const eventHandlers: Partial<Record<'click' | 'contextmenu', (event: { preventDefault: () => void }) => void>> = {}
  let nodes = [createNode({ id: 'existing-node' })]

  beforeEach(() => {
    vi.clearAllMocks()
    nodes = [createNode({ id: 'existing-node' })]
    eventHandlers.click = undefined
    eventHandlers.contextmenu = undefined

    mockUseEventListener.mockImplementation((event: 'click' | 'contextmenu', handler: (event: { preventDefault: () => void }) => void) => {
      eventHandlers[event] = handler
    })
    mockUseStoreApi.mockReturnValue({
      getState: () => ({
        getNodes: () => nodes,
        setNodes: mockSetNodes,
      }),
    })
    mockUseReactFlow.mockReturnValue({
      screenToFlowPosition: ({ x, y }: { x: number, y: number }) => ({ x: x + 10, y: y + 20 }),
    })
    mockUseViewport.mockReturnValue({ zoom: 1.5 })
    mockUseStore.mockImplementation((selector: (state: { mousePosition: {
      pageX: number
      pageY: number
      elementX: number
      elementY: number
    } }) => unknown) => selector({
      mousePosition: {
        pageX: 100,
        pageY: 200,
        elementX: 30,
        elementY: 40,
      },
    }))
    mockUseWorkflowStore.mockReturnValue({
      setState: mockWorkflowStoreSetState,
    })
    mockUseHooks.mockReturnValue({
      useNodesInteractions: createNodesInteractions,
      useWorkflowHistory: createWorkflowHistory,
      useNodesSyncDraft: createNodesSyncDraft,
      useAutoGenerateWebhookUrl: createAutoGenerateWebhookUrl,
    })
    mockHandleSyncWorkflowDraft.mockImplementation((_isSync: boolean, _force: boolean, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    })
    mockGetIterationStartNode.mockReturnValue(createNode({ id: 'iteration-start' }))
    mockGetLoopStartNode.mockReturnValue(createNode({ id: 'loop-start' }))
  })

  it('should render the candidate node and commit a webhook node on click', () => {
    const candidateNode = createNode({
      id: 'candidate-webhook',
      type: CUSTOM_NODE,
      data: {
        type: BlockEnum.TriggerWebhook,
        title: 'Webhook Candidate',
        _isCandidate: true,
      },
    })

    const { container } = render(<CandidateNodeMain candidateNode={candidateNode} />)

    expect(screen.getByTestId('candidate-custom-node')).toHaveTextContent('candidate-webhook')
    expect(container.firstChild).toHaveStyle({
      left: '30px',
      top: '40px',
      transform: 'scale(1.5)',
    })

    eventHandlers.click?.({ preventDefault: vi.fn() })

    expect(mockSetNodes).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'existing-node' }),
      expect.objectContaining({
        id: 'candidate-webhook',
        position: { x: 110, y: 220 },
        data: expect.objectContaining({ _isCandidate: false }),
      }),
    ]))
    expect(mockSaveStateToHistory).toHaveBeenCalledWith('NodeAdd', { nodeId: 'candidate-webhook' })
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ candidateNode: undefined })
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true, true, expect.objectContaining({
      onSuccess: expect.any(Function),
    }))
    expect(mockAutoGenerateWebhookUrl).toHaveBeenCalledWith('candidate-webhook')
    expect(mockHandleNodeSelect).not.toHaveBeenCalled()
  })

  it('should save note candidates as notes and select the inserted note', () => {
    const candidateNode = createNode({
      id: 'candidate-note',
      type: CUSTOM_NOTE_NODE,
      data: {
        type: BlockEnum.Code,
        title: 'Note Candidate',
        _isCandidate: true,
      },
    })

    render(<CandidateNodeMain candidateNode={candidateNode} />)

    expect(screen.getByTestId('candidate-note-node')).toHaveTextContent('candidate-note')

    eventHandlers.click?.({ preventDefault: vi.fn() })

    expect(mockSaveStateToHistory).toHaveBeenCalledWith('NoteAdd', { nodeId: 'candidate-note' })
    expect(mockHandleNodeSelect).toHaveBeenCalledWith('candidate-note')
  })

  it('should append iteration and loop start helper nodes for control-flow candidates', () => {
    const iterationNode = createNode({
      id: 'candidate-iteration',
      type: CUSTOM_NODE,
      data: {
        type: BlockEnum.Iteration,
        title: 'Iteration Candidate',
        _isCandidate: true,
      },
    })
    const loopNode = createNode({
      id: 'candidate-loop',
      type: CUSTOM_NODE,
      data: {
        type: BlockEnum.Loop,
        title: 'Loop Candidate',
        _isCandidate: true,
      },
    })

    const { rerender } = render(<CandidateNodeMain candidateNode={iterationNode} />)

    eventHandlers.click?.({ preventDefault: vi.fn() })
    expect(mockGetIterationStartNode).toHaveBeenCalledWith('candidate-iteration')
    expect(mockSetNodes.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'candidate-iteration' }),
      expect.objectContaining({ id: 'iteration-start' }),
    ]))

    rerender(<CandidateNodeMain candidateNode={loopNode} />)
    eventHandlers.click?.({ preventDefault: vi.fn() })

    expect(mockGetLoopStartNode).toHaveBeenCalledWith('candidate-loop')
    expect(mockSetNodes.mock.calls[1][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'candidate-loop' }),
      expect.objectContaining({ id: 'loop-start' }),
    ]))
  })

  it('should clear the candidate node on contextmenu', () => {
    const candidateNode = createNode({
      id: 'candidate-context',
      type: CUSTOM_NODE,
      data: {
        type: BlockEnum.Code,
        title: 'Context Candidate',
        _isCandidate: true,
      },
    })

    render(<CandidateNodeMain candidateNode={candidateNode} />)

    eventHandlers.contextmenu?.({ preventDefault: vi.fn() })

    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ candidateNode: undefined })
  })
})
