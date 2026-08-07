import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MainNavLink from '../nav-link'

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

const integrationsItem = {
  href: '/integrations/model-provider',
  label: 'Integrations',
  active: () => false,
  icon: 'i-ri-plug-line',
  activeIcon: 'i-ri-plug-fill',
  prefetchOnIntent: true,
}

describe('MainNavLink', () => {
  it('enables Integration route prefetch after pointer intent', async () => {
    const user = userEvent.setup()
    render(<MainNavLink item={integrationsItem} pathname="/apps" />)

    const link = screen.getByRole('link', { name: 'Integrations' })
    expect(link).toHaveAttribute('data-prefetch', 'false')

    await user.hover(link)

    expect(link).toHaveAttribute('data-prefetch', 'auto')
  })

  it('enables Integration route prefetch after keyboard focus', async () => {
    const user = userEvent.setup()
    render(<MainNavLink item={integrationsItem} pathname="/apps" />)

    const link = screen.getByRole('link', { name: 'Integrations' })
    expect(link).toHaveAttribute('data-prefetch', 'false')

    await user.tab()

    expect(link).toHaveFocus()
    expect(link).toHaveAttribute('data-prefetch', 'auto')
  })
})
