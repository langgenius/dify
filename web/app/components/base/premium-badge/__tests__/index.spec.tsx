import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PremiumBadge, { PremiumBadgeButton } from '../index'

describe('PremiumBadge', () => {
  it('renders informational content without button semantics', () => {
    render(<PremiumBadge>Premium</PremiumBadge>)

    expect(screen.getByText('Premium')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('exposes interactive content as a button', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<PremiumBadgeButton onClick={onClick}>Upgrade</PremiumBadgeButton>)

    await user.click(screen.getByRole('button', { name: 'Upgrade' }))

    expect(onClick).toHaveBeenCalledOnce()
  })
})
