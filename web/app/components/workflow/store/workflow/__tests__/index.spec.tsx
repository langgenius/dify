import { renderHook } from '@testing-library/react'
import { WorkflowContext } from '../../../context'
import { createWorkflowStore, useStore, useWorkflowStore } from '../index'

describe('workflow store index', () => {
  it('creates a merged workflow store and exposes it through both hooks', () => {
    const store = createWorkflowStore({})
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkflowContext.Provider value={store}>
        {children}
      </WorkflowContext.Provider>
    )

    const { result } = renderHook(() => ({
      nodes: useStore(state => state.nodes),
      sameStore: useWorkflowStore() === store,
    }), { wrapper })

    expect(result.current.nodes).toEqual([])
    expect(result.current.sameStore).toBe(true)
  })
})
