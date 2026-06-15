import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PremiumBadge, { PremiumBadgeButton } from '../index'

describe('PremiumBadge', () => {
  it('renders with default props', () => {
    render(<PremiumBadge>Premium</PremiumBadge>)
    const badge = screen.getByText('Premium')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('premium-badge-m')
    expect(badge).toHaveClass('premium-badge-blue')
  })

  it('renders with custom size and color', () => {
    render(
      <PremiumBadge size="s" color="indigo">
        Premium
      </PremiumBadge>,
    )
    const badge = screen.getByText('Premium')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('premium-badge-s')
    expect(badge).toHaveClass('premium-badge-indigo')
  })

  it('applies allowHover class when allowHover is true', () => {
    render(
      <PremiumBadgeButton>
        Premium
      </PremiumBadgeButton>,
    )
    const badge = screen.getByText('Premium')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('pb-allow-hover')
  })

  it('applies custom styles', () => {
    render(
      <PremiumBadge styleCss={{ backgroundColor: 'red' }}>
        Premium
      </PremiumBadge>,
    )
    const badge = screen.getByText('Premium')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveStyle('background-color: red')
  })

  it('renders a static badge without button semantics', () => {
    render(<PremiumBadge>Premium</PremiumBadge>)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders an action badge as a button', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()

    render(<PremiumBadgeButton onClick={handleClick}>Upgrade</PremiumBadgeButton>)

    const button = screen.getByRole('button', { name: 'Upgrade' })
    await user.click(button)

    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
