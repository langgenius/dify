import type { StoreApi } from 'zustand'
import { createContext, useContext, useRef } from 'react'
import { useStore } from 'zustand'

/**
 * Creates a typed React context for a Zustand store with null default.
 * Sets displayName for better DevTools labels and error messages.
 */
export function createStoreContext<TState>(name: string) {
  const context = createContext<StoreApi<TState> | null>(null)
  context.displayName = name
  return context
}

/**
 * Hook to lazily initialize a store once via useRef.
 * Use inside a Provider component to create the store on first render.
 *
 * @example
 * ```tsx
 * function MyProvider({ children }: PropsWithChildren) {
 *   const store = useStoreRef(() => createStore<Shape>(set => ({ ... })))
 *   return <MyContext.Provider value={store}>{children}</MyContext.Provider>
 * }
 * ```
 */
export function useStoreRef<T>(factory: () => StoreApi<T>): StoreApi<T> {
  const storeRef = useRef<StoreApi<T>>(null)
  if (!storeRef.current)
    storeRef.current = factory()

  return storeRef.current
}

/**
 * Hook to select state from a Zustand store provided via React context.
 * Throws if the provider is missing.
 *
 * @example
 * ```tsx
 * export function useMyFeature<T>(selector: (state: Shape) => T): T {
 *   return useContextStore(MyContext, selector)
 * }
 * ```
 */
export function useContextStore<TState, T>(
  context: React.Context<StoreApi<TState> | null>,
  selector: (state: TState) => T,
): T {
  const store = useContext(context)
  if (!store) {
    const name = context.displayName || 'Store'
    throw new Error(`Missing ${name} provider in the tree`)
  }

  return useStore(store, selector)
}

/**
 * Hook to access the raw Zustand store API from React context.
 * Throws if the provider is missing.
 *
 * @example
 * ```tsx
 * export function useMyStore() {
 *   return useContextStoreApi(MyContext)
 * }
 * ```
 */
export function useContextStoreApi<TState>(
  context: React.Context<StoreApi<TState> | null>,
): StoreApi<TState> {
  const store = useContext(context)
  if (!store) {
    const name = context.displayName || 'Store'
    throw new Error(`Missing ${name} provider in the tree`)
  }

  return store
}
