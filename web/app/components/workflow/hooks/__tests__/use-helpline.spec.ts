import type { Node } from '../../types'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useHelpline } from '../use-helpline'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock())

function makeNode(overrides: Record<string, unknown> & { id: string }): Node {
  return {
    position: { x: 0, y: 0 },
    width: 240,
    height: 100,
    data: { type: BlockEnum.LLM, title: '', desc: '' },
    ...overrides,
  } as unknown as Node
}

describe('useHelpline', () => {
  beforeEach(() => {
    resetReactFlowMockState()
  })

  it('should return empty arrays for nodes in iteration', () => {
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'n2', position: { x: 0, y: 0 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
    ]

    const { result } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({ id: 'n1', data: { type: BlockEnum.LLM, isInIteration: true } })
    const output = result.current.handleSetHelpline(draggingNode)

    expect(output.showHorizontalHelpLineNodes).toEqual([])
    expect(output.showVerticalHelpLineNodes).toEqual([])
  })

  it('should return empty arrays for nodes in loop', () => {
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
    ]

    const { result } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({ id: 'n1', data: { type: BlockEnum.LLM, isInLoop: true } })
    const output = result.current.handleSetHelpline(draggingNode)

    expect(output.showHorizontalHelpLineNodes).toEqual([])
    expect(output.showVerticalHelpLineNodes).toEqual([])
  })

  it('should detect horizontally aligned nodes (same y ±5px)', () => {
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 100 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'n2', position: { x: 300, y: 103 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'n3', position: { x: 600, y: 500 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
    ]

    const { result } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({ id: 'n1', position: { x: 0, y: 100 } })
    const output = result.current.handleSetHelpline(draggingNode)

    const horizontalIds = output.showHorizontalHelpLineNodes.map((n: { id: string }) => n.id)
    expect(horizontalIds).toContain('n2')
    expect(horizontalIds).not.toContain('n3')
  })

  it('should detect vertically aligned nodes (same x ±5px)', () => {
    rfState.nodes = [
      { id: 'n1', position: { x: 100, y: 0 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'n2', position: { x: 102, y: 200 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'n3', position: { x: 500, y: 400 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
    ]

    const { result } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({ id: 'n1', position: { x: 100, y: 0 } })
    const output = result.current.handleSetHelpline(draggingNode)

    const verticalIds = output.showVerticalHelpLineNodes.map((n: { id: string }) => n.id)
    expect(verticalIds).toContain('n2')
    expect(verticalIds).not.toContain('n3')
  })

  it('should apply entry node offset for Start nodes', () => {
    const ENTRY_OFFSET_Y = 21

    rfState.nodes = [
      { id: 'start', position: { x: 100, y: 100 }, width: 240, height: 100, data: { type: BlockEnum.Start } },
      { id: 'n2', position: { x: 300, y: 100 + ENTRY_OFFSET_Y }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'far', position: { x: 300, y: 500 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
    ]

    const { result } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({
      id: 'start',
      position: { x: 100, y: 100 },
      width: 240,
      height: 100,
      data: { type: BlockEnum.Start },
    })
    const output = result.current.handleSetHelpline(draggingNode)

    const horizontalIds = output.showHorizontalHelpLineNodes.map((n: { id: string }) => n.id)
    expect(horizontalIds).toContain('n2')
    expect(horizontalIds).not.toContain('far')
  })

  it('should apply entry node offset for Trigger nodes', () => {
    const ENTRY_OFFSET_Y = 21

    rfState.nodes = [
      { id: 'trigger', position: { x: 100, y: 100 }, width: 240, height: 100, data: { type: BlockEnum.TriggerWebhook } },
      { id: 'n2', position: { x: 300, y: 100 + ENTRY_OFFSET_Y }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
    ]

    const { result } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({
      id: 'trigger',
      position: { x: 100, y: 100 },
      width: 240,
      height: 100,
      data: { type: BlockEnum.TriggerWebhook },
    })
    const output = result.current.handleSetHelpline(draggingNode)

    const horizontalIds = output.showHorizontalHelpLineNodes.map((n: { id: string }) => n.id)
    expect(horizontalIds).toContain('n2')
  })

  it('should not detect alignment when positions differ by more than 5px', () => {
    rfState.nodes = [
      { id: 'n1', position: { x: 100, y: 100 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'n2', position: { x: 300, y: 106 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'n3', position: { x: 106, y: 300 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
    ]

    const { result } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({ id: 'n1', position: { x: 100, y: 100 } })
    const output = result.current.handleSetHelpline(draggingNode)

    expect(output.showHorizontalHelpLineNodes).toHaveLength(0)
    expect(output.showVerticalHelpLineNodes).toHaveLength(0)
  })

  it('should exclude child nodes in iteration', () => {
    rfState.nodes = [
      { id: 'n1', position: { x: 100, y: 100 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'child', position: { x: 300, y: 100 }, width: 240, height: 100, data: { type: BlockEnum.LLM, isInIteration: true } },
    ]

    const { result } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({ id: 'n1', position: { x: 100, y: 100 } })
    const output = result.current.handleSetHelpline(draggingNode)

    const horizontalIds = output.showHorizontalHelpLineNodes.map((n: { id: string }) => n.id)
    expect(horizontalIds).not.toContain('child')
  })

  it('should set helpLineHorizontal in store when aligned nodes found', () => {
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 100 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'n2', position: { x: 300, y: 100 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
    ]

    const { result, store } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({ id: 'n1', position: { x: 0, y: 100 } })
    result.current.handleSetHelpline(draggingNode)

    expect(store.getState().helpLineHorizontal).toBeDefined()
  })

  it('should clear helpLineHorizontal when no aligned nodes', () => {
    rfState.nodes = [
      { id: 'n1', position: { x: 0, y: 100 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
      { id: 'n2', position: { x: 300, y: 500 }, width: 240, height: 100, data: { type: BlockEnum.LLM } },
    ]

    const { result, store } = renderWorkflowHook(() => useHelpline())

    const draggingNode = makeNode({ id: 'n1', position: { x: 0, y: 100 } })
    result.current.handleSetHelpline(draggingNode)

    expect(store.getState().helpLineHorizontal).toBeUndefined()
  })
})
