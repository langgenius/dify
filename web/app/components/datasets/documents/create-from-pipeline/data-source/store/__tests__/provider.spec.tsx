import { render, screen } from '@testing-library/react'
import { useContext } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DataSourceProvider, { DataSourceContext } from '../provider'

const mockStore = { getState: vi.fn(), setState: vi.fn(), subscribe: vi.fn() }

vi.mock('../', () => ({
  createDataSourceStore: () => mockStore,
}))

// Test consumer component that reads from context
function ContextConsumer() {
  const store = useContext(DataSourceContext)
  return (
    <div data-testid="context-value" data-has-store={store !== null}>
      {store ? 'has-store' : 'no-store'}
    </div>
  )
}

describe('DataSourceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verifies children are passed through
  describe('Rendering', () => {
    it('should render children', () => {
      render(
        <DataSourceProvider>
          <span data-testid="child">Hello</span>
        </DataSourceProvider>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.getByText('Hello')).toBeInTheDocument()
    })
  })

  // Context: verifies the store is provided to consumers
  describe('Context', () => {
    it('should provide store value to context consumers', () => {
      render(
        <DataSourceProvider>
          <ContextConsumer />
        </DataSourceProvider>,
      )

      expect(screen.getByTestId('context-value')).toHaveTextContent('has-store')
      expect(screen.getByTestId('context-value')).toHaveAttribute('data-has-store', 'true')
    })

    it('should provide null when no provider wraps the consumer', () => {
      render(<ContextConsumer />)

      expect(screen.getByTestId('context-value')).toHaveTextContent('no-store')
      expect(screen.getByTestId('context-value')).toHaveAttribute('data-has-store', 'false')
    })
  })

  // Stability: verifies the store reference is stable across re-renders
  describe('Store Stability', () => {
    it('should reuse same store on re-render (stable reference)', () => {
      const storeValues: Array<typeof mockStore | null> = []

      function StoreCapture() {
        const store = useContext(DataSourceContext)
        storeValues.push(store as typeof mockStore | null)
        return null
      }

      const { rerender } = render(
        <DataSourceProvider>
          <StoreCapture />
        </DataSourceProvider>,
      )

      rerender(
        <DataSourceProvider>
          <StoreCapture />
        </DataSourceProvider>,
      )

      expect(storeValues).toHaveLength(2)
      expect(storeValues[0]).toBe(storeValues[1])
    })
  })
})
