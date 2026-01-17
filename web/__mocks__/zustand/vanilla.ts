import type * as ZustandVanillaTypes from 'zustand/vanilla'
import { act } from '@testing-library/react'

export * from 'zustand/vanilla'

const { createStore: actualCreateStore }
  // eslint-disable-next-line antfu/no-top-level-await
  = await vi.importActual<typeof ZustandVanillaTypes>('zustand/vanilla')

export const storeResetFns = new Set<() => void>()

const createStoreUncurried = <T>(
  stateCreator: ZustandVanillaTypes.StateCreator<T>,
) => {
  const store = actualCreateStore(stateCreator)
  const initialState = store.getInitialState()
  storeResetFns.add(() => {
    store.setState(initialState, true)
  })
  return store
}

export const createStore = (<T>(
  stateCreator: ZustandVanillaTypes.StateCreator<T>,
) => {
  return typeof stateCreator === 'function'
    ? createStoreUncurried(stateCreator)
    : createStoreUncurried
}) as typeof ZustandVanillaTypes.createStore

afterEach(() => {
  act(() => {
    storeResetFns.forEach((resetFn) => {
      resetFn()
    })
  })
})
