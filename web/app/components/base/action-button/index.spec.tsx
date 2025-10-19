import { render, screen } from '@testing-library/react'
import { ActionButton, ActionButtonState } from './index'

describe('ActionButton', () => {
  test('renders button with default props', () => {
    render(<ActionButton>Click me</ActionButton>)
    const button = screen.getByRole('button', { name: 'Click me' })
    expect(button).toBeInTheDocument()
    expect(button.classList.contains('action-btn')).toBe(true)
    expect(button.classList.contains('action-btn-m')).toBe(true)
  })

  test('renders button with xs size', () => {
    render(<ActionButton size='xs'>Small Button</ActionButton>)
    const button = screen.getByRole('button', { name: 'Small Button' })
    expect(button.classList.contains('action-btn-xs')).toBe(true)
  })

  test('renders button with l size', () => {
    render(<ActionButton size='l'>Large Button</ActionButton>)
    const button = screen.getByRole('button', { name: 'Large Button' })
    expect(button.classList.contains('action-btn-l')).toBe(true)
  })

  test('renders button with xl size', () => {
    render(<ActionButton size='xl'>Extra Large Button</ActionButton>)
    const button = screen.getByRole('button', { name: 'Extra Large Button' })
    expect(button.classList.contains('action-btn-xl')).toBe(true)
  })

  test('applies correct state classes', () => {
    const { rerender } = render(
      <ActionButton state={ActionButtonState.Destructive}>Destructive</ActionButton>,
    )
    let button = screen.getByRole('button', { name: 'Destructive' })
    expect(button.classList.contains('action-btn-destructive')).toBe(true)

    rerender(<ActionButton state={ActionButtonState.Active}>Active</ActionButton>)
    button = screen.getByRole('button', { name: 'Active' })
    expect(button.classList.contains('action-btn-active')).toBe(true)

    rerender(<ActionButton state={ActionButtonState.Disabled}>Disabled</ActionButton>)
    button = screen.getByRole('button', { name: 'Disabled' })
    expect(button.classList.contains('action-btn-disabled')).toBe(true)

    rerender(<ActionButton state={ActionButtonState.Hover}>Hover</ActionButton>)
    button = screen.getByRole('button', { name: 'Hover' })
    expect(button.classList.contains('action-btn-hover')).toBe(true)
  })

  test('applies custom className', () => {
    render(<ActionButton className='custom-class'>Custom Class</ActionButton>)
    const button = screen.getByRole('button', { name: 'Custom Class' })
    expect(button.classList.contains('custom-class')).toBe(true)
  })

  test('applies custom style', () => {
    render(
      <ActionButton styleCss={{ color: 'red', backgroundColor: 'blue' }}>
        Custom Style
      </ActionButton>,
    )
    const button = screen.getByRole('button', { name: 'Custom Style' })
    expect(button).toHaveStyle({
      color: 'red',
      backgroundColor: 'blue',
    })
  })

  test('forwards additional button props', () => {
    render(<ActionButton disabled data-testid='test-button'>Disabled Button</ActionButton>)
    const button = screen.getByRole('button', { name: 'Disabled Button' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('data-testid', 'test-button')
  })
})
