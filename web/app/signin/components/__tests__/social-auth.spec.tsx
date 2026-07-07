import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocale } from '@/context/i18n'
import { useSearchParams } from '@/next/navigation'
import { getBrowserTimezone } from '@/utils/timezone'
import SocialAuth from '../social-auth'

vi.mock('@/next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
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
    mockUseSearchParams.mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
    mockUseLocale.mockReturnValue('zh-Hans')
    mockGetBrowserTimezone.mockReturnValue('Asia/Shanghai')
  })

  describe('Rendering', () => {
    it('should render oauth provider links', () => {
      render(<SocialAuth />)

      expect(screen.getByRole('link', { name: 'login.withGitHub' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'login.withGoogle' })).toBeInTheDocument()
    })
  })

  describe('OAuth params', () => {
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
        new URLSearchParams('invite_token=invite-123') as unknown as ReturnType<typeof useSearchParams>,
      )

      render(<SocialAuth />)

      const githubLink = screen.getByRole('link', { name: 'login.withGitHub' })
      expect(githubLink).toHaveAttribute('href', expect.stringContaining('invite_token=invite-123'))
      expect(githubLink).toHaveAttribute('href', expect.stringContaining('timezone=Asia%2FShanghai'))
      expect(githubLink).toHaveAttribute('href', expect.stringContaining('language=zh-Hans'))
    })
  })

  describe('Edge Cases', () => {
    it('should omit timezone when browser timezone is unavailable', () => {
      mockGetBrowserTimezone.mockReturnValue(undefined)

      render(<SocialAuth />)

      expect(screen.getByRole('link', { name: 'login.withGitHub' }).getAttribute('href')).not.toContain('timezone=')
    })
  })
})
