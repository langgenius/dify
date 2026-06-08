import type { Edge, Node } from '../../types'
import { act } from '@testing-library/react'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useWorkflowHistory, WorkflowHistoryEvent } from '../use-workflow-history'

const reactFlowState = vi.hoisted(() => ({
  edges: [] as Edge[],
  nodes: [] as Node[],
}))

vi.mock('es-toolkit/compat', () => ({
  debounce: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useStoreApi: () => ({
      getState: () => ({
        getNodes: () => reactFlowState.nodes,
        edges: reactFlowState.edges,
      }),
    }),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  }
})

const nodes: Node[] = [{
  id: 'node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.Start,
    title: 'Start',
    desc: '',
  },
}]

const edges: Edge[] = [{
  id: 'edge-1',
  source: 'node-1',
  target: 'node-2',
  type: 'custom',
  data: {
    sourceType: BlockEnum.Start,
    targetType: BlockEnum.End,
  },
}]

describe('useWorkflowHistory', () => {
  beforeEach(() => {
    reactFlowState.nodes = nodes
    reactFlowState.edges = edges
  })

  it('stores the latest workflow graph snapshot for supported events', () => {
    const { result } = renderWorkflowHook(() => useWorkflowHistory(), {
      historyStore: {
        nodes,
        edges,
      },
    })

    act(() => {
      result.current.saveStateToHistory(WorkflowHistoryEvent.NodeAdd, { nodeId: 'node-1' })
    })

    expect(result.current.store.getState().workflowHistoryEvent).toBe(WorkflowHistoryEvent.NodeAdd)
    expect(result.current.store.getState().workflowHistoryEventMeta).toEqual({ nodeId: 'node-1' })
    expect(result.current.store.getState().nodes).toEqual([
      expect.objectContaining({
        id: 'node-1',
        data: expect.objectContaining({
          selected: false,
          title: 'Start',
        }),
      }),
    ])
    expect(result.current.store.getState().edges).toEqual([
      expect.objectContaining({
        id: 'edge-1',
        selected: false,
        source: 'node-1',
        target: 'node-2',
      }),
    ])
  })

  it('returns translated labels and falls back for unsupported events', () => {
    const { result } = renderWorkflowHook(() => useWorkflowHistory(), {
      historyStore: {
        nodes,
        edges,
      },
    })

    expect(result.current.getHistoryLabel(WorkflowHistoryEvent.NodeDelete)).toBe('changeHistory.nodeDelete')
    expect(result.current.getHistoryLabel('Unknown' as keyof typeof WorkflowHistoryEvent)).toBe('Unknown Event')
  })

  it('runs registered undo and redo callbacks', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()

    const { result } = renderWorkflowHook(() => useWorkflowHistory(), {
      historyStore: {
        nodes,
        edges,
      },
    })

    act(() => {
      result.current.onUndo(onUndo)
      result.current.onRedo(onRedo)
    })

    const temporalState = result.current.store.temporal.getState()
    const undoSpy = vi.fn()
    const redoSpy = vi.fn()
    vi.spyOn(result.current.store.temporal, 'getState').mockReturnValue({
      ...temporalState,
      undo: undoSpy,
      redo: redoSpy,
    })

    act(() => {
      result.current.undo()
      result.current.redo()
    })

    expect(undoSpy).toHaveBeenCalled()
    expect(redoSpy).toHaveBeenCalled()
    expect(onUndo).toHaveBeenCalled()
    expect(onRedo).toHaveBeenCalled()
  })
})
