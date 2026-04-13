import { render } from '@testing-library/react'
import Divider from '../divider'

describe('note editor toolbar divider', () => {
  it('renders the visual separator used inside the toolbar', () => {
    const { container } = render(<Divider />)

    expect(container.firstChild).toHaveClass('mx-1', 'h-3.5', 'w-px', 'bg-divider-regular')
  })
})
