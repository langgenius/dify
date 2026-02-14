import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { useContext } from 'react'
import { FeaturesContext, FeaturesProvider } from './context'

const TestConsumer = () => {
  const store = useContext(FeaturesContext)
  if (!store)
    return <div>no store</div>

  const { features } = store.getState()
  return <div data-testid="store-value">{features.moreLikeThis?.enabled ? 'true' : 'false'}</div>
}

describe('FeaturesProvider', () => {
  it('should provide a store to children', () => {
    render(
      <FeaturesProvider>
        <TestConsumer />
      </FeaturesProvider>,
    )

    expect(screen.getByTestId('store-value')).toHaveTextContent('false')
  })

  it('should accept initial features state', () => {
    render(
      <FeaturesProvider features={{ moreLikeThis: { enabled: true } }}>
        <TestConsumer />
      </FeaturesProvider>,
    )

    expect(screen.getByTestId('store-value')).toHaveTextContent('true')
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
})
