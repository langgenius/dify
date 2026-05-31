import { render } from 'vitest-browser-react'
import {
  Checkbox,
  CheckboxIndicator,
  CheckboxRoot,
  CheckboxSkeleton,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Checkbox', () => {
  it('should render an unchecked checkbox with Base UI semantics', async () => {
    const screen = await render(<Checkbox checked={false} aria-label="Accept terms" />)
    const checkbox = screen.getByRole('checkbox', { name: 'Accept terms' })

    await expect.element(checkbox).toHaveAttribute('aria-checked', 'false')
    await expect.element(checkbox).toHaveAttribute('data-unchecked', '')
    await expect.element(checkbox).not.toHaveAttribute('data-checked')
    await expect.element(checkbox).not.toHaveAttribute('data-indeterminate')
  })

  it('should expose checked data attributes and icon styling hooks', async () => {
    const screen = await render(<Checkbox checked aria-label="Accept terms" />)
    const checkbox = screen.getByRole('checkbox', { name: 'Accept terms' })

    await expect.element(checkbox).toHaveAttribute('aria-checked', 'true')
    await expect.element(checkbox).toHaveAttribute('data-checked', '')
    await expect.element(checkbox).toHaveClass('data-checked:bg-components-checkbox-bg')
    expect(screen.container.querySelector('.i-ri-check-line')).toBeInTheDocument()
  })

  it('should expose mixed state when indeterminate', async () => {
    const screen = await render(<Checkbox checked={false} indeterminate aria-label="Select all" />)
    const checkbox = screen.getByRole('checkbox', { name: 'Select all' })

    await expect.element(checkbox).toHaveAttribute('aria-checked', 'mixed')
    await expect.element(checkbox).toHaveAttribute('data-indeterminate', '')
    expect(screen.container.querySelector('.i-ri-check-line')).not.toBeInTheDocument()
    expect(screen.container.querySelector('span span.rounded-full.bg-current')).toBeInTheDocument()
  })

  it('should call onCheckedChange with the next checked value', async () => {
    const onCheckedChange = vi.fn()
    const screen = await render(
      <Checkbox checked={false} aria-label="Accept terms" onCheckedChange={onCheckedChange} />,
    )

    asHTMLElement(screen.getByRole('checkbox', { name: 'Accept terms' }).element()).click()

    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true)
  })

  it('should stay controlled until the checked prop changes', async () => {
    const onCheckedChange = vi.fn()
    const screen = await render(
      <Checkbox checked={false} aria-label="Accept terms" onCheckedChange={onCheckedChange} />,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Accept terms' })

    asHTMLElement(checkbox.element()).click()
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true)
    await expect.element(checkbox).toHaveAttribute('aria-checked', 'false')

    await screen.rerender(<Checkbox checked aria-label="Accept terms" onCheckedChange={onCheckedChange} />)
    await expect.element(screen.getByRole('checkbox', { name: 'Accept terms' })).toHaveAttribute('aria-checked', 'true')
  })

  it('should ignore interaction when disabled', async () => {
    const onCheckedChange = vi.fn()
    const screen = await render(
      <Checkbox checked={false} disabled aria-label="Accept terms" onCheckedChange={onCheckedChange} />,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Accept terms' })

    await expect.element(checkbox).toHaveAttribute('data-disabled', '')
    await expect.element(checkbox).toHaveClass('data-disabled:cursor-not-allowed')

    asHTMLElement(checkbox.element()).click()

    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('should submit checked and unchecked form values through the hidden input', async () => {
    const screen = await render(
      <form>
        <Checkbox
          checked
          name="terms"
          value="accepted"
          uncheckedValue="declined"
          aria-label="Terms"
        />
        <Checkbox
          checked={false}
          name="newsletter"
          value="yes"
          uncheckedValue="no"
          aria-label="Newsletter"
        />
      </form>,
    )
    const form = screen.container.querySelector('form') as HTMLFormElement
    const data = new FormData(form)

    expect(data.get('terms')).toBe('accepted')
    expect(data.get('newsletter')).toBe('no')
  })

  it('should support custom compound composition with CheckboxRoot and CheckboxIndicator', async () => {
    const screen = await render(
      <CheckboxRoot checked aria-label="Custom checkbox" className="custom-root">
        <CheckboxIndicator className="custom-indicator" />
      </CheckboxRoot>,
    )

    await expect.element(screen.getByRole('checkbox', { name: 'Custom checkbox' })).toHaveClass('custom-root')
    expect(screen.container.querySelector('.custom-indicator')).toBeInTheDocument()
  })
})

describe('CheckboxSkeleton', () => {
  it('should render a visual placeholder without checkbox semantics', async () => {
    const screen = await render(<CheckboxSkeleton data-testid="checkbox-skeleton" />)

    expect(screen.container.querySelector('[role="checkbox"]')).not.toBeInTheDocument()
    await expect.element(screen.getByTestId('checkbox-skeleton')).toHaveClass('bg-text-quaternary', 'opacity-20')
  })
})
