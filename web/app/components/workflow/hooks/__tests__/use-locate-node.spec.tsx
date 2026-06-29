import type { CommonNodeType, Node } from '../../types'
import { renderHook } from '@testing-library/react'
import { useLocateNode } from '../use-locate-node'

const mockHandleNodeSelect = vi.hoisted(() => vi.fn())
const mockScrollToWorkflowNode = vi.hoisted(() => vi.fn())
const mockSearchParams = vi.hoisted(() => new URLSearchParams())
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: Object.assign(vi.fn(), {
    success: mockToastSuccess,
    error: mockToastError,
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.nodeId)
        return `${key}:${options.nodeId}`
      if (options?.title)
        return `${key}:${options.title}`
      return key
    },
  }),
}))

vi.mock('../use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

vi.mock('../../utils/node-navigation', () => ({
  scrollToWorkflowNode: (nodeId: string) => mockScrollToWorkflowNode(nodeId),
}))

const createNode = (overrides: Partial<Node> = {}): Node => ({
  id: 'node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: 'llm',
    title: 'Writer',
    desc: 'Draft content',
  } as CommonNodeType,
  ...overrides,
})

describe('useLocateNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockSearchParams.delete('node_id')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing when node_id param is absent', () => {
    const nodes = [createNode({ id: 'n1' })]
    renderHook(() => useLocateNode(nodes))

    expect(mockHandleNodeSelect).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('does nothing when nodes are empty', () => {
    mockSearchParams.set('node_id', 'n1')
    renderHook(() => useLocateNode([]))

    expect(mockHandleNodeSelect).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('selects, scrolls to, and shows success toast when node is found', () => {
    mockSearchParams.set('node_id', 'target-node')
    const nodes = [createNode({ id: 'target-node', data: { title: 'My Node' } as CommonNodeType })]

    renderHook(() => useLocateNode(nodes))

    expect(mockHandleNodeSelect).toHaveBeenCalledWith('target-node')
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'panel.locateNodeSuccess:My Node',
    )

    // Scroll happens after a 200ms delay
    expect(mockScrollToWorkflowNode).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(mockScrollToWorkflowNode).toHaveBeenCalledWith('target-node')
  })

  it('shows error toast after debounce when node is not found', () => {
    mockSearchParams.set('node_id', 'missing-node')
    const nodes = [createNode({ id: 'other-node' })]

    renderHook(() => useLocateNode(nodes))

    // Not immediately reported
    expect(mockToastError).not.toHaveBeenCalled()

    // After 500ms debounce, reports not found
    vi.advanceTimersByTime(500)
    expect(mockToastError).toHaveBeenCalledWith(
      'panel.locateNodeNotFound:missing-node',
    )
  })

  it('does not report not-found prematurely when nodes are still loading', () => {
    mockSearchParams.set('node_id', 'target-node')
    const initialNodes = [createNode({ id: 'other-node' })]

    const { rerender } = renderHook(
      ({ nodes }) => useLocateNode(nodes),
      { initialProps: { nodes: initialNodes } },
    )

    // Before debounce fires, more nodes arrive including the target
    vi.advanceTimersByTime(300)
    rerender({
      nodes: [
        createNode({ id: 'other-node' }),
        createNode({ id: 'target-node', data: { title: 'Found!' } as CommonNodeType }),
      ],
    })

    // Should have located the node, not reported error
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockHandleNodeSelect).toHaveBeenCalledWith('target-node')
    expect(mockToastSuccess).toHaveBeenCalledWith('panel.locateNodeSuccess:Found!')
  })

  it('locates only once even if nodes update afterwards', () => {
    mockSearchParams.set('node_id', 'target-node')
    const nodes1 = [createNode({ id: 'target-node' })]

    const { rerender } = renderHook(
      ({ nodes }) => useLocateNode(nodes),
      { initialProps: { nodes: nodes1 } },
    )

    expect(mockHandleNodeSelect).toHaveBeenCalledTimes(1)

    // Simulate a nodes update after locate has already happened
    rerender({
      nodes: [createNode({ id: 'target-node' }), createNode({ id: 'extra' })],
    })

    expect(mockHandleNodeSelect).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
  })

  it('clears scroll timeout on unmount', () => {
    mockSearchParams.set('node_id', 'target-node')
    const nodes = [createNode({ id: 'target-node' })]

    const { unmount } = renderHook(() => useLocateNode(nodes))

    // Unmount before the 200ms scroll timer fires
    unmount()

    vi.advanceTimersByTime(500)
    expect(mockScrollToWorkflowNode).not.toHaveBeenCalled()
  })
})
