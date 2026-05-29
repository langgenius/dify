import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessControlOptionCard } from '../index'

describe('AccessControlOptionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render selected content with selected styles', () => {
    render(
      <AccessControlOptionCard selected>
        <span>Selected access</span>
      </AccessControlOptionCard>,
    )

    const card = screen.getByText('Selected access').parentElement

    expect(card).toHaveClass('border-components-option-card-option-selected-border')
    expect(card).toHaveClass('bg-components-option-card-option-selected-bg')
  })

  it('should call onSelect when clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <AccessControlOptionCard onSelect={onSelect}>
        <span>Selectable access</span>
      </AccessControlOptionCard>,
    )

    await user.click(screen.getByRole('button', { name: 'Selectable access' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('should call onSelect from keyboard activation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <AccessControlOptionCard onSelect={onSelect}>
        <span>Keyboard access</span>
      </AccessControlOptionCard>,
    )

    const card = screen.getByRole('button', { name: 'Keyboard access' })
    card.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('should not call onSelect when disabled', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <AccessControlOptionCard disabled onSelect={onSelect}>
        <span>Disabled access</span>
      </AccessControlOptionCard>,
    )

    await user.click(screen.getByText('Disabled access'))

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByText('Disabled access').parentElement).toHaveAttribute('aria-disabled', 'true')
  })
})
