import { render, screen } from '@testing-library/react'
import LogoSite from './logo-site'

vi.mock('@/utils/var', () => ({
  basePath: '/test-base-path',
}))

describe('LogoSite', () => {
  it('renders correctly with default props', () => {
    render(<LogoSite />)
    const img = screen.getByRole('img', { name: /logo/i })
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', '/test-base-path/logo/logo.png')
  })

  it('applies custom className correctly', () => {
    const customClass = 'custom-site-class'
    render(<LogoSite className={customClass} />)
    const img = screen.getByRole('img', { name: /logo/i })
    expect(img).toHaveClass(customClass)
  })
})
