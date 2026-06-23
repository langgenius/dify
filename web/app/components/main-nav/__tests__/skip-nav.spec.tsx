import { render, screen } from '@testing-library/react'
import { SkipNav } from '../skip-nav'

describe('SkipNav', () => {
  it('keeps the shadow hidden until the link is visible', () => {
    render(<SkipNav>Skip to main content</SkipNav>)

    const link = screen.getByRole('link', { name: 'Skip to main content' })

    expect(link).not.toHaveClass('shadow-lg')
    expect(link).not.toHaveClass('shadow-shadow-shadow-5')
    expect(link).toHaveClass('focus-visible:shadow-lg')
    expect(link).toHaveClass('focus-visible:shadow-shadow-shadow-5')
  })
})
