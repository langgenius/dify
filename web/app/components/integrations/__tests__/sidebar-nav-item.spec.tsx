import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntegrationSidebarNavItem } from '../sidebar-nav-item'

vi.mock('@/next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: ReactNode
    href: string
    prefetch?: boolean | null
  }) => (
    <a href={href} data-prefetch={prefetch === null ? 'auto' : prefetch} {...props}>
      {children}
    </a>
  ),
}))

const item = {
  icon: 'i-ri-database-2-line',
  label: 'Data source',
  section: 'data-source' as const,
}

describe('IntegrationSidebarNavItem', () => {
  it('enables route prefetch after pointer intent', async () => {
    const user = userEvent.setup()
    render(<IntegrationSidebarNavItem item={item} section="provider" />)

    const link = screen.getByRole('link', { name: 'Data source' })
    expect(link).toHaveAttribute('data-prefetch', 'false')

    await user.hover(link)

    expect(link).toHaveAttribute('data-prefetch', 'auto')
  })

  it('enables route prefetch after keyboard focus', async () => {
    const user = userEvent.setup()
    render(<IntegrationSidebarNavItem item={item} section="provider" />)

    const link = screen.getByRole('link', { name: 'Data source' })
    expect(link).toHaveAttribute('data-prefetch', 'false')

    await user.tab()

    expect(link).toHaveFocus()
    expect(link).toHaveAttribute('data-prefetch', 'auto')
  })
})
