import { render, screen } from '@testing-library/react'
import WithIconCardItem from '../with-icon-card-item'

it('exposes an icon to assistive technology only when an explicit description is supplied', () => {
  const icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'
  const { rerender } = render(<WithIconCardItem icon={icon}>Card content</WithIconCardItem>)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()

  rerender(
    <WithIconCardItem icon={icon} iconAlt="Card icon">
      Card content
    </WithIconCardItem>,
  )
  expect(screen.getByRole('img', { name: 'Card icon' })).toBeInTheDocument()
})
