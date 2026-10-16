import type { RequiredConnection } from '../required-connections'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import RequiredConnections from '../required-connections'

const navigation = vi.hoisted(() => ({ pathname: '/connections-demo', query: '' }))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

const gmail: RequiredConnection = {
  id: 'gmail',
  name: 'Gmail',
  iconClassName: 'i-ri-mail-line',
}
const github: RequiredConnection = {
  id: 'github',
  name: 'GitHub',
  iconClassName: 'i-ri-github-fill',
}
describe('RequiredConnections', () => {
  beforeEach(() => {
    navigation.pathname = '/connections-demo'
    navigation.query = ''
  })

  it('shows the connections required by the current app and updates when they change', () => {
    const { rerender } = render(<RequiredConnections connections={[gmail, github]} />)

    const section = screen.getByRole('region', { name: 'share.connections.required.title' })
    expect(
      within(section).getByRole('heading', {
        level: 2,
        name: 'share.connections.required.title',
      }),
    ).toBeVisible()
    expect(within(section).getByText('share.connections.required.signInDescription')).toBeVisible()
    const list = within(section).getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('Gmail')).toBeVisible()
    expect(within(list).getByText('GitHub')).toBeVisible()

    rerender(<RequiredConnections connections={[github]} />)

    expect(within(list).queryByText('Gmail')).not.toBeInTheDocument()
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('GitHub')).toBeVisible()
  })

  it('encodes the current page and special query characters once in the sign-in return URL', () => {
    navigation.query = new URLSearchParams({
      prompt: 'Hello 世界 & more',
      conversation: 'a&b',
    }).toString()
    render(<RequiredConnections connections={[gmail]} />)

    const link = screen.getByRole('link', { name: 'share.connections.required.signIn' })
    const destination = new URL(link.getAttribute('href')!, 'https://app.example')
    expect(destination.pathname).toBe('/signin')
    expect(destination.searchParams.get('redirect_url')).toBe(
      `/connections-demo?${navigation.query}`,
    )
    const returnUrl = new URL(destination.searchParams.get('redirect_url')!, 'https://app.example')
    expect(returnUrl.searchParams.get('prompt')).toBe('Hello 世界 & more')
    expect(returnUrl.searchParams.get('conversation')).toBe('a&b')
  })

  it('updates the sign-in return URL when the current path or query changes', () => {
    const { rerender } = render(<RequiredConnections connections={[gmail]} />)
    const link = screen.getByRole('link', { name: 'share.connections.required.signIn' })
    expect(link).toHaveAttribute('href', '/signin?redirect_url=%2Fconnections-demo')

    navigation.pathname = '/workflow/another-app'
    navigation.query = 'conversation=current'
    rerender(<RequiredConnections connections={[gmail]} />)

    const destination = new URL(link.getAttribute('href')!, 'https://app.example')
    expect(destination.searchParams.get('redirect_url')).toBe(
      '/workflow/another-app?conversation=current',
    )
  })

  it('hides the connection prompt when the app requires no connections', () => {
    const { rerender } = render(<RequiredConnections connections={[gmail]} />)

    rerender(<RequiredConnections connections={[]} />)

    expect(
      screen.queryByRole('region', { name: 'share.connections.required.title' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'share.connections.required.signIn' }),
    ).not.toBeInTheDocument()
  })
})
