import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { useContext } from 'react'
import { FeaturesContext, FeaturesProvider } from './context'

const TestConsumer = () => {
  const store = useContext(FeaturesContext)
  if (!store)
    return <div>no store</div>

  const { features } = store.getState()
  return <div role="status">{features.moreLikeThis?.enabled ? 'enabled' : 'disabled'}</div>
}

describe('FeaturesProvider', () => {
  it('should provide store to children when FeaturesProvider wraps them', () => {
    render(
      <FeaturesProvider>
        <TestConsumer />
      </FeaturesProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('disabled')
  })

  it('should provide initial features state when features prop is provided', () => {
    render(
      <FeaturesProvider features={{ moreLikeThis: { enabled: true } }}>
        <TestConsumer />
      </FeaturesProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('enabled')
  })

  it('should maintain the same store reference across re-renders', () => {
    const storeRefs: Array<ReturnType<typeof useContext>> = []

    const StoreRefCollector = () => {
      const store = useContext(FeaturesContext)
      storeRefs.push(store)
      return null
    }

    const { rerender } = render(
      <FeaturesProvider>
        <StoreRefCollector />
      </FeaturesProvider>,
    )

    rerender(
      <FeaturesProvider>
        <StoreRefCollector />
      </FeaturesProvider>,
    )

    expect(storeRefs[0]).toBe(storeRefs[1])
  })

  it('should handle empty features object', () => {
    render(
      <FeaturesProvider features={{}}>
        <TestConsumer />
      </FeaturesProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('disabled')
  })
})
