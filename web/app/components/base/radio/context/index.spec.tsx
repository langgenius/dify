import { render, screen } from '@testing-library/react'
import { useContextSelector } from 'use-context-selector'
// context.spec.tsx
import { describe, expect, it } from 'vitest'
import RadioGroupContext from './index'

function Consumer() {
  const value = useContextSelector(RadioGroupContext, v => v)
  return <div data-testid="ctx-value">{JSON.stringify(value)}</div>
}

describe('RadioGroupContext', () => {
  it('provides null as default value when no provider is used', () => {
    render(<Consumer />)

    const node = screen.getByTestId('ctx-value')
    expect(node).toBeInTheDocument()
    expect(node).toHaveTextContent('null')
  })

  it('provides value from provider when wrapped', () => {
    const providedValue = { value: 'radio', onChange: () => {} }

    render(
      <RadioGroupContext.Provider value={providedValue}>
        <Consumer />
      </RadioGroupContext.Provider>,
    )

    const node = screen.getByTestId('ctx-value')
    expect(node).toBeInTheDocument()
    expect(node).toHaveTextContent(JSON.stringify(providedValue))
  })

  it('updates when provider value changes', () => {
    const first = { value: 'first', onChange: () => {} }
    const second = { value: 'second', onChange: () => {} }

    const { rerender } = render(
      <RadioGroupContext.Provider value={first}>
        <Consumer />
      </RadioGroupContext.Provider>,
    )

    expect(screen.getByTestId('ctx-value')).toHaveTextContent(
      JSON.stringify(first),
    )

    rerender(
      <RadioGroupContext.Provider value={second}>
        <Consumer />
      </RadioGroupContext.Provider>,
    )

    expect(screen.getByTestId('ctx-value')).toHaveTextContent(
      JSON.stringify(second),
    )
  })
})
