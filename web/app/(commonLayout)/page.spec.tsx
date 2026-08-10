import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('@/features/home/page', () => ({
  HomePage: () => null,
}))

vi.mock('@/next/navigation', () => ({
  redirect: (url: string) => mocks.redirect(url),
}))

describe('Home route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens billing for the legacy education verification action', async () => {
    const { default: Page } = await import('./page')

    await expect(
      Page({
        searchParams: Promise.resolve({
          action: 'getEducationVerify',
          utm_source: 'education-email',
        }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith('/?settings=billing&utm_source=education-email')
  })
})
