import { renderHook } from '@testing-library/react'
import { HooksStoreContext } from '../provider'
import { createHooksStore, useHooksStore } from '../store'

describe('hooks-store store', () => {
  it('creates default callbacks and refreshes selected handlers', () => {
    const store = createHooksStore({})
    const handleBackupDraft = vi.fn()

    expect(store.getState().availableNodesMetaData).toEqual({ nodes: [] })
    expect(store.getState().hasNodeInspectVars('node-1')).toBe(false)
    expect(store.getState().getWorkflowRunAndTraceUrl('run-1')).toEqual({
      runUrl: '',
      traceUrl: '',
    })

    store.getState().refreshAll({ handleBackupDraft })

    expect(store.getState().handleBackupDraft).toBe(handleBackupDraft)
  })

  it('reads state from the hooks store context', () => {
    const handleRun = vi.fn()
    const store = createHooksStore({ handleRun })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HooksStoreContext.Provider value={store}>
        {children}
      </HooksStoreContext.Provider>
    )

    const { result } = renderHook(() => useHooksStore(state => state.handleRun), { wrapper })

    expect(result.current).toBe(handleRun)
  })

  it('throws when the hooks store provider is missing', () => {
    expect(() => renderHook(() => useHooksStore(state => state.handleRun))).toThrow(
      'Missing HooksStoreContext.Provider in the tree',
    )
  })
})
