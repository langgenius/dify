import { describe, expect, it, vi } from 'vite-plus/test'
import { redirect } from '@/next/navigation'
import ForgotPassword from '../page'

vi.mock('@/next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

describe('legacy forgot-password route', () => {
  it('redirects to the reset-password flow', async () => {
    await expect(ForgotPassword({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'redirect:/reset-password',
    )
    expect(redirect).toHaveBeenCalledWith('/reset-password')
  })

  it('keeps the query string, including repeated and encoded values', async () => {
    await expect(
      ForgotPassword({
        searchParams: Promise.resolve({
          email: 'a+b@example.com',
          tag: ['x', 'y'],
          empty: undefined,
        }),
      }),
    ).rejects.toThrow()
    expect(redirect).toHaveBeenCalledWith('/reset-password?email=a%2Bb%40example.com&tag=x&tag=y')
  })
})
