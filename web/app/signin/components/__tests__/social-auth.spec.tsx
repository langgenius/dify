import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useLocale } from '#i18n'
import { useSearchParams } from '@/next/navigation'
import { getBrowserTimezone } from '@/utils/timezone'
import SocialAuth from '../social-auth'

vi.mock('@/next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(),
}))

vi.mock('@/utils/timezone', () => ({
  getBrowserTimezone: vi.fn(),
}))

const mockUseSearchParams = vi.mocked(useSearchParams)
const mockUseLocale = vi.mocked(useLocale)
const mockGetBrowserTimezone = vi.mocked(getBrowserTimezone)

describe('SocialAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSearchParams.mockReturnValue(new URLSearchParams() as ReturnType<typeof useSearchParams>)
    mockUseLocale.mockReturnValue('zh-Hans')
    mockGetBrowserTimezone.mockReturnValue('Asia/Shanghai')
  })

  describe('OAuth params', () => {
    it('preserves the direct End User return parameters while keeping OAuth in End User mode', () => {
      const target = {
        is_end_user: '1',
        redirect_url: 'https://agent-app.dify.dev/workflow/my-webapp?input=hello',
      }
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams(target) as ReturnType<typeof useSearchParams>,
      )
      render(<SocialAuth />)

      for (const name of ['login.withGitHub', 'login.withGoogle']) {
        const oauth = new URL(
          screen.getByRole('link', { name }).getAttribute('href')!,
          window.location.origin,
        )
        expect(oauth.searchParams.get('mode')).toBe('end_user')
        const resume = new URL(oauth.searchParams.get('redirect_url')!, window.location.origin)
        expect(resume.origin).toBe(window.location.origin)
        expect(resume.pathname).toBe('/signin')
        expect(Object.fromEntries(resume.searchParams)).toEqual(target)
      }
    })

    it('should include browser timezone and locale in oauth links', () => {
      render(<SocialAuth />)

      expect(screen.getByRole('link', { name: 'login.withGitHub' })).toHaveAttribute(
        'href',
        expect.stringContaining('timezone=Asia%2FShanghai'),
      )
      expect(screen.getByRole('link', { name: 'login.withGitHub' })).toHaveAttribute(
        'href',
        expect.stringContaining('language=zh-Hans'),
      )
      expect(screen.getByRole('link', { name: 'login.withGoogle' })).toHaveAttribute(
        'href',
        expect.stringContaining('timezone=Asia%2FShanghai'),
      )
      expect(screen.getByRole('link', { name: 'login.withGoogle' })).toHaveAttribute(
        'href',
        expect.stringContaining('language=zh-Hans'),
      )
    })

    it('should preserve invite token when adding timezone', () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams('invite_token=invite-123') as ReturnType<typeof useSearchParams>,
      )

      render(<SocialAuth />)

      const githubLink = screen.getByRole('link', { name: 'login.withGitHub' })
      expect(githubLink).toHaveAttribute('href', expect.stringContaining('invite_token=invite-123'))
      expect(githubLink).toHaveAttribute(
        'href',
        expect.stringContaining('timezone=Asia%2FShanghai'),
      )
      expect(githubLink).toHaveAttribute('href', expect.stringContaining('language=zh-Hans'))
    })
  })

  describe('Edge Cases', () => {
    it('should omit timezone when browser timezone is unavailable', () => {
      mockGetBrowserTimezone.mockReturnValue(undefined)

      render(<SocialAuth />)

      expect(
        screen.getByRole('link', { name: 'login.withGitHub' }).getAttribute('href'),
      ).not.toContain('timezone=')
    })
  })
})
