import { render } from '@testing-library/react'
import Header from '../header'

vi.mock('@/next/link', () => ({
  default: ({
    children,
    href,
    replace,
    className,
  }: {
    children: React.ReactNode
    href: string
    replace?: boolean
    className?: string
  }) => (
    <a href={href} data-replace={replace} className={className}>
      {children}
    </a>
  ),
}))

describe('Header', () => {
  it('links back to the dataset list', () => {
    const { container } = render(<Header />)

    expect(container.querySelector('a')).toHaveAttribute('href', '/datasets')
  })
})
