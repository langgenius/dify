import type * as ZustandExportedTypes from 'zustand'
import { act } from '@testing-library/react'

export * from 'zustand'

const { create: actualCreate, createStore: actualCreateStore }
  // eslint-disable-next-line antfu/no-top-level-await
  = await vi.importActual<typeof ZustandExportedTypes>('zustand')

export const storeResetFns = new Set<() => void>()

const createUncurried = <T>(
  stateCreator: ZustandExportedTypes.StateCreator<T>,
) => {
  const store = actualCreate(stateCreator)
  const initialState = store.getInitialState()
  storeResetFns.add(() => {
    store.setState(initialState, true)
  })
  return store
}

export const create = (<T>(
  stateCreator: ZustandExportedTypes.StateCreator<T>,
) => {
  return typeof stateCreator === 'function'
    ? createUncurried(stateCreator)
    : createUncurried
}) as typeof ZustandExportedTypes.create

const createStoreUncurried = <T>(
  stateCreator: ZustandExportedTypes.StateCreator<T>,
) => {
  const store = actualCreateStore(stateCreator)
  const initialState = store.getInitialState()
  storeResetFns.add(() => {
    store.setState(initialState, true)
  })
  return store
}

export const createStore = (<T>(
  stateCreator: ZustandExportedTypes.StateCreator<T>,
) => {
  return typeof stateCreator === 'function'
    ? createStoreUncurried(stateCreator)
    : createStoreUncurried
}) as typeof ZustandExportedTypes.createStore

afterEach(() => {
  act(() => {
    storeResetFns.forEach((resetFn) => {
      resetFn()
    })
  })
})
