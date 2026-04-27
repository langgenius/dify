import type { StoreApi } from 'zustand'
import { act, render, renderHook, screen } from '@testing-library/react'
import { use } from 'react'
import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createStoreContext, useContextStore, useContextStoreApi, useStoreRef } from '../create-context-store'

type TestShape = {
  count: number
  increment: () => void
}

const createTestStore = (initial = 0) =>
  createStore<TestShape>(set => ({
    count: initial,
    increment: () => set(s => ({ count: s.count + 1 })),
  }))

describe('createStoreContext', () => {
  it('should create a context with null default value', () => {
    const context = createStoreContext<TestShape>('Test')

    function Consumer() {
      const value = use(context)
      return <div data-testid="value">{value === null ? 'null' : 'has-store'}</div>
    }

    render(<Consumer />)
    expect(screen.getByTestId('value')).toHaveTextContent('null')
  })

  it('should set displayName on the context', () => {
    const context = createStoreContext<TestShape>('MyStore')
    expect(context.displayName).toBe('MyStore')
  })
})

describe('useStoreRef', () => {
  it('should create the store once and return the same reference on re-renders', () => {
    const stores: StoreApi<TestShape>[] = []
    const context = createStoreContext<TestShape>('Test')

    function TestProvider({ children }: { children: React.ReactNode }) {
      const store = useStoreRef(() => createTestStore())
      stores.push(store)
      return <context.Provider value={store}>{children}</context.Provider>
    }

    const { rerender } = render(
      <TestProvider>
        <div>child</div>
      </TestProvider>,
    )

    rerender(
      <TestProvider>
        <div>child</div>
      </TestProvider>,
    )

    expect(stores).toHaveLength(2)
    expect(stores[0]).toBe(stores[1])
  })
})

describe('useContextStore', () => {
  it('should return selected state from context store', () => {
    const context = createStoreContext<TestShape>('Test')
    const store = createTestStore(42)

    const { result } = renderHook(() => useContextStore(context, s => s.count), {
      wrapper: ({ children }) => (
        <context.Provider value={store}>{children}</context.Provider>
      ),
    })

    expect(result.current).toBe(42)
  })

  it('should throw with displayName in error message when used outside provider', () => {
    const context = createStoreContext<TestShape>('MyFeature')

    expect(() => {
      renderHook(() => useContextStore(context, s => s.count))
    }).toThrow('Missing MyFeature provider in the tree')
  })

  it('should throw with default name when displayName is not set', () => {
    const context = createStoreContext<TestShape>('')
    context.displayName = ''

    expect(() => {
      renderHook(() => useContextStore(context, s => s.count))
    }).toThrow('Missing Store provider in the tree')
  })

  it('should re-render when selected state changes', () => {
    const context = createStoreContext<TestShape>('Test')
    const store = createTestStore(0)

    function Counter() {
      const count = useContextStore(context, s => s.count)
      return <div data-testid="count">{count}</div>
    }

    render(
      <context.Provider value={store}>
        <Counter />
      </context.Provider>,
    )

    expect(screen.getByTestId('count')).toHaveTextContent('0')

    act(() => {
      store.getState().increment()
    })

    expect(screen.getByTestId('count')).toHaveTextContent('1')
  })
})

describe('useContextStoreApi', () => {
  it('should return the store API from context', () => {
    const context = createStoreContext<TestShape>('Test')
    const store = createTestStore(7)

    const { result } = renderHook(() => useContextStoreApi(context), {
      wrapper: ({ children }) => (
        <context.Provider value={store}>{children}</context.Provider>
      ),
    })

    expect(result.current).toBe(store)
    expect(result.current.getState().count).toBe(7)
  })

  it('should throw when used outside provider', () => {
    const context = createStoreContext<TestShape>('Test')

    expect(() => {
      renderHook(() => useContextStoreApi(context))
    }).toThrow('Missing Test provider in the tree')
  })
})
