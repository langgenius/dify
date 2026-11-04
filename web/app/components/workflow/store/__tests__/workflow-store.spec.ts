import { act, renderHook } from '@testing-library/react'
import { createRagPipelineSliceSlice } from '@/app/components/rag-pipeline/store'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { createTestWorkflowStore, renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { createWorkflowStore, useStore, useWorkflowStore } from '../workflow'

describe('workflow store composition', () => {
  it('updates clipboard nodes and edges atomically without affecting another editor', () => {
    const store = createTestWorkflowStore()
    const other = createTestWorkflowStore()
    const nodes = [createNode({ id: 'n-1' })]
    const edges = [createEdge({ id: 'e-1', source: 'n-1', target: 'n-2' })]
    const observed = vi.fn()
    const unsubscribe = store.subscribe((state) =>
      observed({ nodes: state.clipboardElements, edges: state.clipboardEdges }),
    )
    store.getState().setClipboardData({ nodes, edges })
    expect(observed).toHaveBeenCalledExactlyOnceWith({ nodes, edges })
    expect(other.getState().clipboardElements).toEqual([])
    expect(other.getState().clipboardEdges).toEqual([])
    unsubscribe()
  })

  it('subscribes selectors to the store supplied by the workflow provider', () => {
    const { result, store } = renderWorkflowHook(() => ({
      visible: useStore((s) => s.showSingleRunPanel),
      instance: useWorkflowStore(),
    }))
    expect(result.current.visible).toBe(false)
    act(() => store.getState().setShowSingleRunPanel(true))
    expect(result.current.visible).toBe(true)
    expect(result.current.instance).toBe(store)
  })

  it('rejects a selector without a workflow provider', () => {
    expect(() => renderHook(() => useStore((s) => s.showSingleRunPanel))).toThrow(
      'Missing WorkflowContext.Provider in the tree',
    )
  })

  it('injects a pipeline slice whose actions share the base store', () => {
    const store = createWorkflowStore({ injectWorkflowStoreSliceFn: createRagPipelineSliceSlice })
    store.getState().setShowInputFieldPanel?.(true)
    store.getState().setShowSingleRunPanel(true)
    expect(store.getState()).toMatchObject({ showInputFieldPanel: true, showSingleRunPanel: true })
  })
})
