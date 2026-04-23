import type { Edge, Node } from '../types'
import type { WorkflowHistoryState } from '../workflow-history-store'
import { render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '../types'
import { useWorkflowHistoryStore, WorkflowHistoryProvider } from '../workflow-history-store'

const nodes: Node[] = [
  {
    id: 'node-1',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      title: 'Start',
      desc: '',
      type: BlockEnum.Start,
      selected: true,
    },
    selected: true,
  },
]

const edges: Edge[] = [
  {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2',
    sourceHandle: null,
    targetHandle: null,
    type: 'custom',
    selected: true,
    data: {
      sourceType: BlockEnum.Start,
      targetType: BlockEnum.End,
    },
  },
]

const HistoryConsumer = () => {
  const { store, shortcutsEnabled, setShortcutsEnabled } = useWorkflowHistoryStore()

  return (
    <button onClick={() => setShortcutsEnabled(!shortcutsEnabled)}>
      {`nodes:${store.getState().nodes.length} shortcuts:${String(shortcutsEnabled)}`}
    </button>
  )
}

describe('WorkflowHistoryProvider', () => {
  it('provides workflow history state and shortcut toggles', async () => {
    const user = userEvent.setup()

    render(
      <WorkflowHistoryProvider
        nodes={nodes}
        edges={edges}
      >
        <HistoryConsumer />
      </WorkflowHistoryProvider>,
    )

    expect(screen.getByRole('button', { name: 'nodes:1 shortcuts:true' }))!.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'nodes:1 shortcuts:true' }))
    expect(screen.getByRole('button', { name: 'nodes:1 shortcuts:false' }))!.toBeInTheDocument()
  })

  it('sanitizes selected flags when history state is replaced through the exposed store api', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkflowHistoryProvider
        nodes={nodes}
        edges={edges}
      >
        {children}
      </WorkflowHistoryProvider>
    )

    const { result } = renderHook(() => useWorkflowHistoryStore(), { wrapper })
    const nextState: WorkflowHistoryState = {
      workflowHistoryEvent: undefined,
      workflowHistoryEventMeta: undefined,
      nodes,
      edges,
    }

    result.current.store.setState(nextState)

    expect(result.current.store.getState().nodes[0]!.data.selected).toBe(false)
    expect(result.current.store.getState().edges[0]!.selected).toBe(false)
  })

  it('throws when consumed outside the provider', () => {
    expect(() => renderHook(() => useWorkflowHistoryStore())).toThrow(
      'useWorkflowHistoryStoreApi must be used within a WorkflowHistoryProvider',
    )
  })
})
