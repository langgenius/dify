import { act, renderHook } from '@testing-library/react'
import { HooksStoreContext } from '../provider'
import { createHooksStore, useHooksStore } from '../store'

it('routes consumers to refreshed handlers while preserving other callbacks', () => {
  const initialRun = vi.fn()
  const updatedRun = vi.fn()
  const backup = vi.fn()
  const store = createHooksStore({ handleRun: initialRun, handleBackupDraft: backup })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <HooksStoreContext.Provider value={store}>{children}</HooksStoreContext.Provider>
  )
  const { result } = renderHook(() => useHooksStore((state) => state.handleRun), { wrapper })
  result.current({ query: 'first' })
  expect(initialRun).toHaveBeenCalledWith({ query: 'first' })

  act(() => store.getState().refreshAll({ handleRun: updatedRun }))
  result.current({ query: 'second' })
  expect(updatedRun).toHaveBeenCalledWith({ query: 'second' })
  expect(initialRun).toHaveBeenCalledTimes(1)
  store.getState().handleBackupDraft()
  expect(backup).toHaveBeenCalledOnce()
})

it('throws when the hooks store provider is missing', () => {
  expect(() => renderHook(() => useHooksStore((state) => state.handleRun))).toThrow(
    'Missing HooksStoreContext.Provider in the tree',
  )
})
