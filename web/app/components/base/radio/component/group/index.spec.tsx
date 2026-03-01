import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useContextSelector } from 'use-context-selector'
// Group.test.tsx
import { describe, expect, it, vi } from 'vitest'
import RadioGroupContext from '../../context'
import Group from './index'

// small consumer that uses the same context as your component
function ContextConsumer({ showButton = true }: { showButton?: boolean }) {
  // eslint-disable-next-line ts/no-explicit-any
  const ctx = useContextSelector(RadioGroupContext, (v: any) => v)
  const value = ctx?.value
  const onChange = ctx?.onChange
  return (
    <div>
      <span data-testid="radio-value">{String(value)}</span>
      {showButton && (
        <button
          data-testid="radio-change-btn"
          onClick={() => onChange?.('clicked-from-test')}
        >
          change
        </button>
      )}
    </div>
  )
}

describe('Group component', () => {
  it('renders children and exposes provided value through context', () => {
    render(
      <Group value="initial-value">
        <ContextConsumer />
      </Group>,
    )

    const valueNode = screen.getByTestId('radio-value')
    expect(valueNode).toBeInTheDocument()
    expect(valueNode).toHaveTextContent('initial-value')
  })

  it('merges custom className with existing classes on root element', () => {
    const { container } = render(
      <Group value="v" className="my-extra-class">
        <ContextConsumer />
      </Group>,
    )

    const root = container.firstChild as HTMLElement

    expect(root).toBeInTheDocument()
    expect(root.className).toContain('my-extra-class')

    // ensure it still has other classes (from cn + css module)
    expect(root.className.length).toBeGreaterThan('my-extra-class'.length)
  })

  it('calls onChange from context when consumer triggers it', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <Group value="whatever" onChange={handleChange}>
        <ContextConsumer />
      </Group>,
    )

    const btn = screen.getByTestId('radio-change-btn')
    await user.click(btn)
    expect(handleChange).toHaveBeenCalledTimes(1)
    expect(handleChange).toHaveBeenCalledWith('clicked-from-test')
  })

  it('does not throw if onChange is not provided and consumer calls it', async () => {
    const user = userEvent.setup()
    render(
      <Group value={0}>
        {/* the consumer will call onChange which is undefined */}
        <ContextConsumer />
      </Group>,
    )

    const btn = screen.getByTestId('radio-change-btn')
    // clicking should not throw (if it threw the test would fail)
    await user.click(btn)
    // value still rendered correctly (verifies consumer reads numeric/false-y values too)
    expect(screen.getByTestId('radio-value')).toHaveTextContent('0')
  })

  it('correctly passes boolean and numeric values through context', () => {
    render(
      <>
        <Group value={false}>
          <ContextConsumer />
        </Group>
        <Group value={123}>
          <ContextConsumer showButton={false} />
        </Group>
      </>,
    )

    const nodes = screen.getAllByTestId('radio-value')
    // first should be "false", second "123"
    expect(nodes[0]).toHaveTextContent('false')
    expect(nodes[1]).toHaveTextContent('123')
  })
})
