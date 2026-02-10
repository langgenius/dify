import { render, screen } from '@testing-library/react'
import CornerLabel from '.'

describe('CornerLabel', () => {
  it('renders the label correctly', () => {
    render(<CornerLabel label="Test Label" />)
    expect(screen.getByText('Test Label')).toBeInTheDocument()
  })

  it('applies custom class names', () => {
    const { container } = render(<CornerLabel label="Test Label" className="custom-class" labelClassName="custom-label-class" />)
    expect(container.querySelector('.custom-class')).toBeInTheDocument()
    expect(container.querySelector('.custom-label-class')).toBeInTheDocument()
    expect(screen.getByText('Test Label')).toBeInTheDocument()
  })
})
