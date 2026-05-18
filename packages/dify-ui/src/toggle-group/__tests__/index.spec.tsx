import { render } from 'vitest-browser-react'
import {
  ToggleGroup,
  ToggleGroupDivider,
  ToggleGroupItem,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('ToggleGroup wrappers', () => {
  it('renders a segmented control with Base UI pressed state', async () => {
    const screen = await render(
      <ToggleGroup defaultValue={['one']} aria-label="View">
        <ToggleGroupItem value="one">One</ToggleGroupItem>
        <ToggleGroupItem value="two">Two</ToggleGroupItem>
      </ToggleGroup>,
    )

    await expect.element(screen.getByRole('group')).toHaveClass(
      'bg-components-segmented-control-bg-normal',
      'p-0.5',
      'rounded-[10px]',
    )
    await expect.element(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'true')
    await expect.element(screen.getByRole('button', { name: 'One' })).toHaveClass(
      'data-pressed:bg-components-segmented-control-item-active-bg',
      'data-pressed:text-text-accent-light-mode-only',
    )
  })

  it('uses single selection by default', async () => {
    const screen = await render(
      <ToggleGroup defaultValue={['one']} aria-label="View">
        <ToggleGroupItem value="one">One</ToggleGroupItem>
        <ToggleGroupItem value="two">Two</ToggleGroupItem>
      </ToggleGroup>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'Two' }).element()).click()

    await expect.element(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'false')
    await expect.element(screen.getByRole('button', { name: 'Two' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onValueChange while leaving controlled value to the caller', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <ToggleGroup value={['one']} onValueChange={onValueChange} aria-label="View">
        <ToggleGroupItem value="one">One</ToggleGroupItem>
        <ToggleGroupItem value="two">Two</ToggleGroupItem>
      </ToggleGroup>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'Two' }).element()).click()

    expect(onValueChange).toHaveBeenCalledWith(['two'], expect.anything())
    await expect.element(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('forwards disabled and className to composable parts', async () => {
    const screen = await render(
      <ToggleGroup defaultValue={['one']} aria-label="View" className="custom-group">
        <ToggleGroupItem value="one" className="custom-item">One</ToggleGroupItem>
        <ToggleGroupDivider className="custom-divider" data-testid="divider" />
        <ToggleGroupItem value="two" disabled>Two</ToggleGroupItem>
      </ToggleGroup>,
    )

    await expect.element(screen.getByRole('group')).toHaveClass('custom-group')
    await expect.element(screen.getByRole('button', { name: 'One' })).toHaveClass('custom-item')
    await expect.element(screen.getByRole('button', { name: 'Two' })).toBeDisabled()
    await expect.element(screen.getByTestId('divider')).toHaveClass('custom-divider')
  })
})
