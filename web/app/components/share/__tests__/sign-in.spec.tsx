import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import SignIn from '../sign-in'

const navigation = vi.hoisted(() => ({ pathname: '/workflow/demo', query: '' }))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

describe('Web app SignIn', () => {
  const originalUrl = window.location.href
  beforeEach(() => {
    navigation.pathname = '/workflow/demo'
    navigation.query = ''
  })
  afterEach(() => window.history.replaceState({}, '', originalUrl))

  it('keeps the current fragment in the full Webapp return URL', () => {
    window.history.replaceState({}, '', '/workflow/demo#earlier-conversation')
    render(<SignIn />)
    const destination = new URL(
      screen.getByRole('link', { name: 'share.auth.signIn' }).getAttribute('href')!,
      window.location.origin,
    )
    expect(destination.pathname).toBe('/signin')
    expect(destination.searchParams.get('is_end_user')).toBe('1')
    expect(destination.searchParams.get('redirect_url')).toBe(
      new URL('/workflow/demo#earlier-conversation', window.location.origin).href,
    )
  })

  it('returns to the current page after sign-in without corrupting Unicode or special query characters', () => {
    navigation.pathname = '/workflow/应用'
    navigation.query = new URLSearchParams({
      prompt: '你好 & a+b / 50%',
      conversation: 'a&b',
    }).toString()
    render(<SignIn />)

    const link = screen.getByRole('link', { name: 'share.auth.signIn' })
    const destination = new URL(link.getAttribute('href')!, 'https://app.example')
    expect(destination.pathname).toBe('/signin')
    expect(destination.searchParams.get('is_end_user')).toBe('1')
    expect(destination.searchParams.get('redirect_url')).toBe(
      new URL(`${navigation.pathname}?${navigation.query}`, window.location.origin).href,
    )
    const returnUrl = new URL(destination.searchParams.get('redirect_url')!, 'https://app.example')
    expect(decodeURIComponent(returnUrl.pathname)).toBe('/workflow/应用')
    expect(returnUrl.searchParams.get('prompt')).toBe('你好 & a+b / 50%')
    expect(returnUrl.searchParams.get('conversation')).toBe('a&b')
  })

  it('updates the return URL when navigating and removes a query that is no longer present', () => {
    const { rerender } = render(<SignIn />)
    expect(screen.getByRole('link', { name: 'share.auth.signIn' })).toHaveAttribute(
      'href',
      `/signin?${new URLSearchParams({ redirect_url: new URL('/workflow/demo', window.location.origin).href, is_end_user: '1' })}`,
    )

    navigation.pathname = '/workflow/another-app'
    navigation.query = 'conversation=current'
    rerender(<SignIn />)

    const destination = new URL(
      screen.getByRole('link', { name: 'share.auth.signIn' }).getAttribute('href')!,
      'https://app.example',
    )
    expect(destination.searchParams.get('redirect_url')).toBe(
      new URL('/workflow/another-app?conversation=current', window.location.origin).href,
    )

    navigation.query = ''
    rerender(<SignIn />)
    expect(screen.getByRole('link', { name: 'share.auth.signIn' })).toHaveAttribute(
      'href',
      `/signin?${new URLSearchParams({ redirect_url: new URL('/workflow/another-app', window.location.origin).href, is_end_user: '1' })}`,
    )
  })
})
