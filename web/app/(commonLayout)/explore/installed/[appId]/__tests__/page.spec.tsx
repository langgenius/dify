import { describe, expect, it, vi } from 'vitest'
import { redirect } from '@/next/navigation'
import InstalledApp from '../page'

vi.mock('@/next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

describe('legacy installed app route', () => {
  it('redirects to the canonical installed app route', async () => {
    await expect(
      InstalledApp({
        params: Promise.resolve({ appId: 'installed-1' }),
      }),
    ).rejects.toThrow('redirect:/installed/installed-1')

    expect(redirect).toHaveBeenCalledWith('/installed/installed-1')
  })
})
