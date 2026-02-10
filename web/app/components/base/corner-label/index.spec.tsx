import { render, screen } from '@testing-library/react'
import CornerLabel from '.'

describe('CornerLabel', () => {
  it('renders the label correctly', () => {
    render(<CornerLabel label="Test Label" />)
    expect(screen.getByText('Test Label')).toBeInTheDocument()
  })

  it('applies custom class names', () => {
    render(<CornerLabel label="Test Label" className="custom-class" labelClassName="custom-label-class" />)
    const cornerLabel = screen.getByText('Test Label').parentElement?.parentElement
    expect(cornerLabel).toHaveClass('custom-class')
    expect(screen.getByText('Test Label').parentElement).toHaveClass('custom-label-class')
  })
})
