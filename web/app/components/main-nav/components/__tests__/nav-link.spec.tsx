import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MainNavLink from '../nav-link'

const fetchCurrentWorkspace = vi.hoisted(() => vi.fn(() => new Promise(() => {})))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.summary.get': fetchCurrentWorkspace,
    }),
  }
})

it('keeps non-Studio navigation independent of Console workspace data', () => {
  const destinations = [
    { href: '/my-apps', label: 'My Apps' },
    { href: '/connections', label: 'Connections' },
    { href: '/account', label: 'Account' },
  ]

  renderWithConsoleQuery(
    <>
      {destinations.map((destination) => (
        <MainNavLink
          key={destination.href}
          item={{
            ...destination,
            icon: 'i-ri-apps-line',
            activeIcon: 'i-ri-apps-fill',
            active: (pathname) =>
              pathname === destination.href || pathname.startsWith(`${destination.href}/`),
          }}
          pathname="/connections/drive"
        />
      ))}
    </>,
    { currentWorkspace: null },
  )

  for (const { href, label } of destinations) {
    const link = screen.getByRole('link', { name: label })
    expect(link).toHaveAttribute('href', href)
    if (href === '/connections') expect(link).toHaveAttribute('aria-current', 'page')
    else expect(link).not.toHaveAttribute('aria-current')
  }
  expect(fetchCurrentWorkspace).not.toHaveBeenCalled()
})
