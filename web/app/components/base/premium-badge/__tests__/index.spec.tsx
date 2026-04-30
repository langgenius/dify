import { render, screen } from '@testing-library/react'
import PremiumBadge from '../index'

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
      <PremiumBadge allowHover>
        Premium
      </PremiumBadge>,
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
})
