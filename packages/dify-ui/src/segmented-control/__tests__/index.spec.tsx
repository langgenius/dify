import * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { SegmentedControl, SegmentedControlDivider, SegmentedControlItem } from '../index'

function SegmentedControlTypeExamples() {
  return (
    <>
      <SegmentedControl<number> value={10} onValueChange={() => {}} aria-label="Page size">
        <SegmentedControlItem<number> value={10}>10</SegmentedControlItem>
        <SegmentedControlItem<number> value={20}>20</SegmentedControlItem>
      </SegmentedControl>
      {/* @ts-expect-error segmented controls require either value or defaultValue */}
      <SegmentedControl aria-label="Missing value">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
      </SegmentedControl>
    </>
  )
}

void SegmentedControlTypeExamples

describe('SegmentedControl', () => {
  it('exposes a required single choice through radio semantics', async () => {
    const screen = await render(
      <SegmentedControl defaultValue="one" aria-label="View">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
        <SegmentedControlItem value="two">Two</SegmentedControlItem>
      </SegmentedControl>,
    )

    await expect.element(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
    await expect
      .element(screen.getByRole('radio', { name: 'One' }))
      .toHaveAttribute('aria-checked', 'true')
    await expect
      .element(screen.getByRole('radio', { name: 'Two' }))
      .toHaveAttribute('aria-checked', 'false')
  })

  it('updates an uncontrolled selection without allowing the selected item to be cleared', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <SegmentedControl defaultValue="one" onValueChange={onValueChange} aria-label="View">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
        <SegmentedControlItem value="two">Two</SegmentedControlItem>
      </SegmentedControl>,
    )

    await screen.getByRole('radio', { name: 'One' }).click()

    expect(onValueChange).not.toHaveBeenCalled()
    await expect
      .element(screen.getByRole('radio', { name: 'One' }))
      .toHaveAttribute('aria-checked', 'true')

    await screen.getByRole('radio', { name: 'Two' }).click()

    expect(onValueChange).toHaveBeenCalledWith('two', expect.anything())
    await expect
      .element(screen.getByRole('radio', { name: 'Two' }))
      .toHaveAttribute('aria-checked', 'true')
  })

  it('leaves a controlled selection to its caller', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <SegmentedControl value="one" onValueChange={onValueChange} aria-label="View">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
        <SegmentedControlItem value="two">Two</SegmentedControlItem>
      </SegmentedControl>,
    )

    await screen.getByRole('radio', { name: 'Two' }).click()

    expect(onValueChange).toHaveBeenCalledWith('two', expect.anything())
    await expect
      .element(screen.getByRole('radio', { name: 'One' }))
      .toHaveAttribute('aria-checked', 'true')
  })

  it('selects the next enabled item with an arrow key', async () => {
    const screen = await render(
      <SegmentedControl defaultValue="one" aria-label="View">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
        <SegmentedControlItem value="two" disabled>
          Two
        </SegmentedControlItem>
        <SegmentedControlItem value="three">Three</SegmentedControlItem>
      </SegmentedControl>,
    )

    const one = screen.getByRole('radio', { name: 'One' })
    const three = screen.getByRole('radio', { name: 'Three' })
    ;(one.element() as HTMLElement).focus()

    await userEvent.keyboard('{ArrowRight}')

    await expect.element(three).toHaveFocus()
    await expect.element(three).toHaveAttribute('aria-checked', 'true')
  })

  it('uses non-submitting native buttons for its items', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    const screen = await render(
      <form onSubmit={onSubmit}>
        <SegmentedControl defaultValue="one" aria-label="View">
          <SegmentedControlItem value="one">One</SegmentedControlItem>
          <SegmentedControlItem value="two">Two</SegmentedControlItem>
        </SegmentedControl>
      </form>,
    )

    await screen.getByRole('radio', { name: 'Two' }).click()

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps disabled item semantics and a decorative divider', async () => {
    const screen = await render(
      <SegmentedControl defaultValue="one" aria-label="View">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
        <SegmentedControlDivider data-testid="divider" />
        <SegmentedControlItem value="two" disabled>
          Two
        </SegmentedControlItem>
      </SegmentedControl>,
    )

    await expect.element(screen.getByRole('radio', { name: 'Two' })).toBeDisabled()
    await expect.element(screen.getByTestId('divider')).toHaveAttribute('aria-hidden', 'true')
  })
})
