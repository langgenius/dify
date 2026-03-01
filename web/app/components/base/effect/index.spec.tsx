import { render } from '@testing-library/react'
import Effect from '.'

describe('Effect', () => {
  it('applies custom class names', () => {
    const { container } = render(<Effect className="custom-class" />)
    expect(container.firstChild).toHaveClass('custom-class')
  })
})
