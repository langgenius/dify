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
  beforeEach(() => {
    navigation.pathname = '/workflow/demo'
    navigation.query = ''
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
    expect(destination.searchParams.get('redirect_url')).toBe(
      `${navigation.pathname}?${navigation.query}`,
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
      '/signin?redirect_url=%2Fworkflow%2Fdemo',
    )

    navigation.pathname = '/workflow/another-app'
    navigation.query = 'conversation=current'
    rerender(<SignIn />)

    const destination = new URL(
      screen.getByRole('link', { name: 'share.auth.signIn' }).getAttribute('href')!,
      'https://app.example',
    )
    expect(destination.searchParams.get('redirect_url')).toBe(
      '/workflow/another-app?conversation=current',
    )

    navigation.query = ''
    rerender(<SignIn />)
    expect(screen.getByRole('link', { name: 'share.auth.signIn' })).toHaveAttribute(
      'href',
      '/signin?redirect_url=%2Fworkflow%2Fanother-app',
    )
  })
})
