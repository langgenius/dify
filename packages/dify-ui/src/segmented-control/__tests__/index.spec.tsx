import { render } from 'vitest-browser-react'
import { SegmentedControl, SegmentedControlDivider, SegmentedControlItem } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('SegmentedControl wrappers', () => {
  it('renders a segmented control with Base UI pressed state', async () => {
    const screen = await render(
      <SegmentedControl defaultValue={['one']} aria-label="View">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
        <SegmentedControlItem value="two">Two</SegmentedControlItem>
      </SegmentedControl>,
    )

    await expect
      .element(screen.getByRole('button', { name: 'One' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('uses single selection by default', async () => {
    const screen = await render(
      <SegmentedControl defaultValue={['one']} aria-label="View">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
        <SegmentedControlItem value="two">Two</SegmentedControlItem>
      </SegmentedControl>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'Two' }).element()).click()

    await expect
      .element(screen.getByRole('button', { name: 'One' }))
      .toHaveAttribute('aria-pressed', 'false')
    await expect
      .element(screen.getByRole('button', { name: 'Two' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onValueChange while leaving controlled value to the caller', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <SegmentedControl value={['one']} onValueChange={onValueChange} aria-label="View">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
        <SegmentedControlItem value="two">Two</SegmentedControlItem>
      </SegmentedControl>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'Two' }).element()).click()

    expect(onValueChange).toHaveBeenCalledWith(['two'], expect.anything())
    await expect
      .element(screen.getByRole('button', { name: 'One' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('preserves Base UI empty-array behavior when a single selected item is toggled off', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <SegmentedControl value={['one']} onValueChange={onValueChange} aria-label="View">
        <SegmentedControlItem value="one">One</SegmentedControlItem>
        <SegmentedControlItem value="two">Two</SegmentedControlItem>
      </SegmentedControl>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'One' }).element()).click()

    expect(onValueChange).toHaveBeenCalledWith([], expect.anything())
    await expect
      .element(screen.getByRole('button', { name: 'One' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('forwards disabled and className to composable parts', async () => {
    const screen = await render(
      <SegmentedControl defaultValue={['one']} aria-label="View" className="custom-group">
        <SegmentedControlItem value="one" className="custom-item">
          One
        </SegmentedControlItem>
        <SegmentedControlDivider className="custom-divider" data-testid="divider" />
        <SegmentedControlItem value="two" disabled>
          Two
        </SegmentedControlItem>
      </SegmentedControl>,
    )

    await expect.element(screen.getByRole('group')).toHaveClass('custom-group')
    await expect.element(screen.getByRole('button', { name: 'One' })).toHaveClass('custom-item')
    await expect.element(screen.getByRole('button', { name: 'Two' })).toBeDisabled()
    await expect.element(screen.getByTestId('divider')).toHaveClass('custom-divider')
  })
})
